/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialPutOptions, ICredentialStore } from "@workglow/util";
import type { IKvStorage } from "../kv/IKvStorage";
import type { SecretVault } from "./SecretVault";

/** Persisted metadata row (NO secret value). */
export interface CredentialMetadataRow {
  readonly userId: string;
  readonly projectId: string;
  readonly key: string;
  readonly label: string | undefined;
  readonly provider: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | undefined;
  /**
   * True while a new-entry put() is mid-flight (metadata written but vault
   * write not yet acknowledged), or sticky-true if vault rollback failed and
   * the row is an orphan marker. Readers (get/has/listMetadata/keys) MUST
   * treat pending rows as absent. Absent or `false` means committed.
   */
  readonly pending?: boolean;
  /**
   * ISO timestamp written if the new-entry rollback path itself failed. The
   * vault may still contain bytes for this id; operators should reconcile.
   */
  readonly orphanedAt?: string;
  /**
   * Diagnostic discriminator written alongside `orphanedAt`. Identifies the
   * failure path that produced the orphan marker so operators can pick a
   * remediation strategy without re-running the original write:
   *   - "vault-write-failed":     new-entry put, vault.setSecret threw and
   *     metadata.delete also failed; vault may still hold bytes.
   *   - "metadata-commit-failed": new-entry put, vault.setSecret succeeded
   *     but the commit metadata.put (clearing `pending`) failed; vault holds
   *     bytes that no committed row points at.
   *   - "vault-delete-failed":    delete(), metadata.delete succeeded but
   *     vault.deleteSecret failed; metadata row reinstated as pending so
   *     readers see absence, vault holds orphan bytes.
   */
  readonly orphanReason?: "vault-write-failed" | "metadata-commit-failed" | "vault-delete-failed";
}

/** Discriminator for the `orphanReason` field on {@link CredentialMetadataRow}. */
export type OrphanReason = NonNullable<CredentialMetadataRow["orphanReason"]>;

/** Metadata shape exposed to the API list route (no value). */
export interface CredentialMetadataInfo {
  readonly key: string;
  readonly label: string | undefined;
  readonly provider: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | undefined;
}

export interface ServerCredentialStoreOptions {
  readonly vault: SecretVault;
  readonly metadata: IKvStorage<string, CredentialMetadataRow>;
  readonly userId: string;
  readonly projectId: string;
}

/**
 * Project-scoped credential store. Secret bytes live in a {@link SecretVault};
 * metadata lives in an {@link IKvStorage}. Decryption happens only here, in
 * the process that owns the vault — never in the renderer.
 */
export class ServerCredentialStore implements ICredentialStore {
  /**
   * Strict grammar for any segment that goes into the vault id
   * (`${userId}/${projectId}/${key}`). Restricting to URL-safe-ish characters
   * and capping length at 128 chars closes a key-injection class: without it,
   * a key like `"../../other-user/other-project/leaked"` could be smuggled
   * through, escape the project scope, and collide with another user's
   * vault id. The bounds are also chosen so the joined vault id stays well
   * under common KV/file-system key-length limits.
   */
  private static readonly SAFE_SEGMENT = /^[A-Za-z0-9._:-]{1,128}$/;

  private readonly vault: SecretVault;
  private readonly metadata: IKvStorage<string, CredentialMetadataRow>;
  private readonly userId: string;
  private readonly projectId: string;
  private readonly prefix: string;

  constructor(opts: ServerCredentialStoreOptions) {
    // Validate scope segments BEFORE storing them. Once they are mixed into
    // `this.prefix` and queried against `metadata.getAll()` they cannot be
    // un-poisoned, so fail loudly at construction time. We use a TypeError
    // (programmer-supplied data) and keep the message generic so the invalid
    // value is not echoed back to a caller that may have come from an
    // untrusted source.
    if (
      !ServerCredentialStore.SAFE_SEGMENT.test(opts.userId) ||
      !ServerCredentialStore.SAFE_SEGMENT.test(opts.projectId)
    ) {
      throw new TypeError("ServerCredentialStore: invalid userId/projectId");
    }
    this.vault = opts.vault;
    this.metadata = opts.metadata;
    this.userId = opts.userId;
    this.projectId = opts.projectId;
    this.prefix = `${this.userId}/${this.projectId}/`;
  }

  /**
   * Build the prefixed vault id for `key`. Re-validates `key` against the
   * SAFE_SEGMENT grammar on every call: `put` is the only public path that
   * routes through here (it must throw loudly so a programmer error cannot
   * silently persist a colliding vault id). Reader methods (`get`/`has`/
   * `delete`) short-circuit via {@link isSafeKey} instead so they keep the
   * `ICredentialStore` contract of returning `undefined`/`false` for invalid
   * keys, preserving substitutability with the other stores.
   */
  private vaultId(key: string): string {
    if (!ServerCredentialStore.SAFE_SEGMENT.test(key)) {
      throw new TypeError("ServerCredentialStore: invalid key");
    }
    return `${this.prefix}${key}`;
  }

  /**
   * Non-throwing key predicate used by readers (`get`/`has`/`delete`). The
   * `ICredentialStore` contract documents these methods as returning
   * `undefined`/`false` for absent or invalid keys; throwing on every invalid
   * lookup breaks substitutability with the other credential stores
   * (`InMemoryCredentialStore`, `EncryptedKvCredentialStore`). `put` keeps
   * routing through {@link vaultId} so a malicious key cannot persist a
   * colliding vault id.
   */
  private isSafeKey(key: string): boolean {
    return ServerCredentialStore.SAFE_SEGMENT.test(key);
  }

  /**
   * Inverse of {@link vaultId} for `deleteAll`: strips the user/project
   * prefix to recover the original key. Only called on ids already
   * confirmed in-scope by {@link scopedIds}.
   */
  private unscopedKey(id: string): string {
    return id.slice(this.prefix.length);
  }

  private isExpired(row: CredentialMetadataRow): boolean {
    return row.expiresAt !== undefined && new Date(row.expiresAt) <= new Date();
  }

  private isPending(row: CredentialMetadataRow): boolean {
    return row.pending === true;
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.isSafeKey(key)) return undefined;
    const id = `${this.prefix}${key}`;
    const row = await this.metadata.get(id);
    if (!row) return undefined;
    if (this.isPending(row)) return undefined;
    if (this.isExpired(row)) {
      // Best-effort self-eviction: a swallowed throw here keeps `get(key)` a
      // pure read from the caller's perspective. Without the try/catch a
      // transient KV or vault failure on eviction would surface as a thrown
      // get() even though the row IS already absent (expired) — the next
      // call to get/has will retry the eviction.
      try {
        await this.delete(key);
      } catch {
        // Swallow: the row is expired so we still report absence to the caller.
      }
      return undefined;
    }
    return this.vault.getSecret(id);
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    const id = this.vaultId(key);
    const now = new Date().toISOString();
    const existing = await this.metadata.get(id);
    const baseRow: CredentialMetadataRow = {
      userId: this.userId,
      projectId: this.projectId,
      key,
      label: options?.label ?? existing?.label,
      provider: options?.provider ?? existing?.provider,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: options?.expiresAt ? options.expiresAt.toISOString() : existing?.expiresAt,
    };

    if (existing === undefined) {
      // New entry: write a pending metadata row BEFORE the vault, so concurrent
      // get() observers gate on `pending` and see absence rather than a torn
      // value. Then write the vault, then flip pending off.
      await this.metadata.put(id, { ...baseRow, pending: true });
      try {
        await this.vault.setSecret(id, value);
      } catch (vaultError) {
        // Vault write failed; roll the metadata row back. If THAT also fails,
        // mark the row as an orphan so an operator can reconcile manually.
        try {
          await this.metadata.delete(id);
        } catch {
          try {
            await this.metadata.put(id, {
              ...baseRow,
              pending: true,
              orphanedAt: new Date().toISOString(),
              orphanReason: "vault-write-failed",
            });
          } catch {
            // Nothing more we can do; surface the original vault error.
          }
          throw new Error(
            `ServerCredentialStore.put: vault write failed and rollback may have orphaned vault id ${id}`,
            { cause: vaultError }
          );
        }
        throw vaultError;
      }
      // Commit: clear the pending flag. If THIS write fails after a successful
      // vault write, the row stays `pending: true` (invisible to readers) while
      // the vault still holds bytes — same orphan failure mode as the rollback
      // path above. Persist a sticky orphan marker (best-effort) and throw a
      // wrapped error so the inconsistency is discoverable. We do NOT roll the
      // vault back: a future retry may recover by re-running the commit-step
      // metadata write.
      try {
        await this.metadata.put(id, { ...baseRow, pending: false });
      } catch (commitError) {
        try {
          await this.metadata.put(id, {
            ...baseRow,
            pending: true,
            orphanedAt: new Date().toISOString(),
            orphanReason: "metadata-commit-failed",
          });
        } catch {
          // Nothing more we can do.
        }
        throw new Error(
          `ServerCredentialStore.put: vault write succeeded but metadata commit failed for vault id ${id}; row left as orphan marker`,
          { cause: commitError }
        );
      }
      return;
    }

    // Update is not atomic across the (vault, metadata) pair. We overwrite the
    // vault first, then the metadata row. A concurrent get() between the two
    // writes sees the OLD metadata row (non-pending, so visible) but the NEW
    // vault value — a stale-metadata window for (updatedAt, expiresAt, label,
    // provider), not a torn vault read (each vault.setSecret is atomic at the
    // vault layer). We do NOT roll the vault back if the metadata update
    // throws: the prior metadata row still points at the same vault id, so
    // subsequent reads return the new value (alongside stale metadata) instead
    // of going missing. Closing this window cleanly requires versioned vault
    // ids (e.g., `${prefix}${key}#${version}`) so the old metadata keeps
    // pointing at the old vault entry; tracked as a follow-up.
    await this.vault.setSecret(id, value);
    await this.metadata.put(id, baseRow);
  }

  /**
   * Internal delete by already-resolved vault id, shared by {@link delete}
   * (via {@link deleteById}) and {@link deleteAll} (via {@link forceDeleteById}).
   * Centralises the metadata-first ordering and the orphan-marker rewrite so
   * the two callers cannot drift out of sync.
   *
   * `op` is interpolated into the error message ("delete" vs "deleteAll")
   * so operators can tell which public method observed the failure.
   *
   * Ordering rationale:
   *   1. Delete metadata FIRST. If that throws, the vault is untouched
   *      and the row stays visible — readers continue to get the secret,
   *      same as before the call.
   *   2. If the vault delete then fails we reinstate a pending+orphaned
   *      metadata row so readers see absence (correct) while a sticky
   *      marker remains for operator reconciliation. If the marker write
   *      itself fails, the row is fully unrecoverable from the store's
   *      perspective — surface that clearly in the error message so an
   *      operator knows whether they have a metadata trail to follow.
   *
   * Pending-row policy lives in the callers: {@link deleteById} short-circuits
   * to avoid the put/delete race, while {@link forceDeleteById} is the wipe
   * path that must clear sticky orphan markers and in-flight pending rows.
   */
  private async commitDelete(
    id: string,
    key: string,
    existing: CredentialMetadataRow,
    op: "delete" | "deleteAll"
  ): Promise<true> {
    // Metadata first: a throw here leaves the row intact and the vault
    // untouched, which is the safe failure mode (still readable, no half-state).
    await this.metadata.delete(id);

    try {
      await this.vault.deleteSecret(id);
    } catch (vaultError) {
      let markerWritten = false;
      try {
        await this.metadata.put(id, {
          ...existing,
          pending: true,
          orphanedAt: new Date().toISOString(),
          orphanReason: "vault-delete-failed",
        });
        markerWritten = true;
      } catch {
        // Best effort only; fall through to surface the original vault error.
      }
      throw new Error(
        `ServerCredentialStore.${op}: metadata removed but vault delete failed for key ` +
          key +
          (markerWritten ? "; orphan marker persisted" : "; orphan marker also failed to persist"),
        { cause: vaultError }
      );
    }
    return true;
  }

  /**
   * Internal delete used by {@link delete}. Short-circuits on pending rows:
   * a pending row is either an in-flight new-entry put() or a sticky orphan
   * marker, and in both cases the vault state is something only the owning
   * operation should mutate. Returning false here is the close for both the
   * orphan-overwrite hazard and the put/delete race.
   *
   * {@link deleteAll} deliberately does NOT route through this path — it uses
   * {@link forceDeleteById} so a scope-wide wipe actually clears those rows.
   */
  private async deleteById(id: string, key: string): Promise<boolean> {
    const existing = await this.metadata.get(id);
    if (existing === undefined) return false;
    if (this.isPending(existing)) return false;
    return this.commitDelete(id, key, existing, "delete");
  }

  async delete(key: string): Promise<boolean> {
    if (!this.isSafeKey(key)) return false;
    return this.deleteById(`${this.prefix}${key}`, key);
  }

  async has(key: string): Promise<boolean> {
    if (!this.isSafeKey(key)) return false;
    const row = await this.metadata.get(`${this.prefix}${key}`);
    if (!row) return false;
    if (this.isPending(row)) return false;
    if (this.isExpired(row)) {
      // Best-effort self-eviction; see {@link get} for rationale.
      try {
        await this.delete(key);
      } catch {
        // Swallow: the row is expired so we still report absence to the caller.
      }
      return false;
    }
    return true;
  }

  async keys(): Promise<readonly string[]> {
    return (await this.listMetadata()).map((m) => m.key);
  }

  /**
   * Vault ids of every row in this scope, ignoring expiry and pending state.
   * Filters on key prefix first (cheap string check), then re-asserts the
   * userId/projectId fields as defence-in-depth in case of corrupt rows.
   */
  private async scopedIds(): Promise<string[]> {
    const all = await this.metadata.getAll();
    if (!all) return [];
    const ids: string[] = [];
    for (const entry of all) {
      if (!entry.key.startsWith(this.prefix)) continue;
      if (entry.value.userId !== this.userId || entry.value.projectId !== this.projectId) continue;
      ids.push(entry.key);
    }
    return ids;
  }

  /**
   * Variant of {@link deleteById} that does NOT short-circuit on pending rows.
   * `deleteAll` is an operator-level "wipe scope" operation whose whole job is
   * to clear sticky orphan markers (rows where the original `delete` failed
   * its vault hop and reinstated a `pending: true` marker) as well as
   * still-in-flight pending new-entry rows. Routing `deleteAll` through
   * {@link deleteById} would silently skip both — there would be no public API
   * that could clear an orphan, defeating the purpose of writing the marker in
   * the first place. The metadata-first ordering and orphan-marker rewrite on
   * vault-delete failure are preserved via the shared {@link commitDelete}.
   */
  private async forceDeleteById(id: string, key: string): Promise<boolean> {
    const existing = await this.metadata.get(id);
    if (existing === undefined) return false;
    return this.commitDelete(id, key, existing, "deleteAll");
  }

  async deleteAll(): Promise<void> {
    // Route through forceDeleteById so sticky orphan markers and in-flight
    // pending rows are actually wiped — the single-key `deleteById` skips
    // pending rows on purpose (orphan-overwrite / put/delete race), but a
    // scope-wide wipe MUST clear them. Collect per-row failures and re-throw
    // as an AggregateError so a single bad row does not silently mask the rest.
    const errors: unknown[] = [];
    for (const id of await this.scopedIds()) {
      try {
        await this.forceDeleteById(id, this.unscopedKey(id));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "ServerCredentialStore.deleteAll: one or more entries failed"
      );
    }
  }

  /** Metadata for every non-expired, committed credential in this project scope. */
  async listMetadata(): Promise<CredentialMetadataInfo[]> {
    const all = await this.metadata.getAll();
    if (!all) return [];
    const out: CredentialMetadataInfo[] = [];
    for (const entry of all) {
      if (!entry.key.startsWith(this.prefix)) continue;
      const row = entry.value;
      if (row.userId !== this.userId || row.projectId !== this.projectId) continue;
      if (this.isPending(row)) continue;
      if (this.isExpired(row)) continue;
      out.push({
        key: row.key,
        label: row.label,
        provider: row.provider,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        expiresAt: row.expiresAt,
      });
    }
    return out;
  }
}

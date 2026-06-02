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
  private static readonly SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

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
   * SAFE_SEGMENT grammar on every call: callers are external code paths
   * (`get`/`put`/`delete`/`has`) that may receive `key` from request input,
   * so rejecting unsafe characters here closes the key-injection class
   * (slashes, control characters, oversized values).
   */
  private vaultId(key: string): string {
    if (!ServerCredentialStore.SAFE_SEGMENT.test(key)) {
      throw new TypeError("ServerCredentialStore: invalid key");
    }
    return `${this.prefix}${key}`;
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
    const id = this.vaultId(key);
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
   * Internal delete by already-resolved vault id. Centralises the
   * metadata-first ordering, the orphan-marker logic, and the put/delete
   * race protection so {@link delete} and {@link deleteAll} share one
   * code path. `key` is passed through only for the human-readable error
   * message; the id is the source of truth.
   *
   * Ordering rationale:
   *   1. If the row is pending (mid-flight put OR an existing orphan
   *      marker) we MUST NOT touch the vault — a concurrent new-entry
   *      put() that has written its pending metadata row but not yet
   *      written the vault would otherwise see its vault entry deleted
   *      out from under it, leaving an orphan. Returning false here
   *      makes delete() idempotent against pending rows and closes the
   *      orphan-overwrite race.
   *   2. Delete metadata FIRST. If that throws, the vault is untouched
   *      and the row stays visible — readers continue to get the secret,
   *      same as before the call. If it succeeds and the vault delete
   *      then fails we reinstate a pending+orphaned metadata row so
   *      readers see absence (correct) while a sticky marker remains
   *      for operator reconciliation.
   */
  private async deleteById(id: string, key: string): Promise<boolean> {
    const existing = await this.metadata.get(id);
    if (existing === undefined) return false;
    // Pending rows are either an in-flight new-entry put() or a sticky orphan
    // marker; in both cases the vault state is something only the owning
    // operation should mutate. Returning false here is the close for both the
    // orphan-overwrite hazard and the put/delete race.
    if (this.isPending(existing)) return false;

    // Metadata first: a throw here leaves the row intact and the vault
    // untouched, which is the safe failure mode (still readable, no half-state).
    await this.metadata.delete(id);

    try {
      await this.vault.deleteSecret(id);
    } catch (vaultError) {
      // Metadata is already gone; readers now see absence (correct from their
      // point of view) but the vault still holds bytes for this id. Reinstate
      // a pending orphan marker so the row is invisible to readers AND
      // discoverable by operator reconciliation. If the marker write itself
      // fails, the row is fully unrecoverable from the store's perspective —
      // surface that clearly in the error message so an operator knows whether
      // they have a metadata trail to follow.
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
        "ServerCredentialStore.delete: metadata removed but vault delete failed for key " +
          key +
          (markerWritten ? "; orphan marker persisted" : "; orphan marker also failed to persist"),
        { cause: vaultError }
      );
    }
    return true;
  }

  async delete(key: string): Promise<boolean> {
    return this.deleteById(this.vaultId(key), key);
  }

  async has(key: string): Promise<boolean> {
    const row = await this.metadata.get(this.vaultId(key));
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

  async deleteAll(): Promise<void> {
    // Delegate each row to deleteById so the metadata-first ordering and
    // orphan-marker logic stay in one place. Collect per-row failures and
    // re-throw as an AggregateError so a single bad row does not silently
    // skip the rest of the scope, and so the caller can see every failure.
    const errors: unknown[] = [];
    for (const id of await this.scopedIds()) {
      try {
        await this.deleteById(id, this.unscopedKey(id));
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

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
}

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
  private readonly vault: SecretVault;
  private readonly metadata: IKvStorage<string, CredentialMetadataRow>;
  private readonly userId: string;
  private readonly projectId: string;
  private readonly prefix: string;

  constructor(opts: ServerCredentialStoreOptions) {
    this.vault = opts.vault;
    this.metadata = opts.metadata;
    this.userId = opts.userId;
    this.projectId = opts.projectId;
    this.prefix = `${this.userId}/${this.projectId}/`;
  }

  private vaultId(key: string): string {
    return `${this.prefix}${key}`;
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
      await this.delete(key);
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

  async delete(key: string): Promise<boolean> {
    const id = this.vaultId(key);
    const existed = (await this.metadata.get(id)) !== undefined;
    if (existed) {
      await this.vault.deleteSecret(id);
      await this.metadata.delete(id);
    }
    return existed;
  }

  async has(key: string): Promise<boolean> {
    const row = await this.metadata.get(this.vaultId(key));
    if (!row) return false;
    if (this.isPending(row)) return false;
    if (this.isExpired(row)) {
      await this.delete(key);
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
    for (const id of await this.scopedIds()) {
      await this.vault.deleteSecret(id);
      await this.metadata.delete(id);
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

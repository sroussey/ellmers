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

  async get(key: string): Promise<string | undefined> {
    const id = this.vaultId(key);
    const row = await this.metadata.get(id);
    if (!row) return undefined;
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
    await this.vault.setSecret(id, value);
    const row: CredentialMetadataRow = {
      userId: this.userId,
      projectId: this.projectId,
      key,
      label: options?.label ?? existing?.label,
      provider: options?.provider ?? existing?.provider,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: options?.expiresAt ? options.expiresAt.toISOString() : existing?.expiresAt,
    };
    await this.metadata.put(id, row);
  }

  async delete(key: string): Promise<boolean> {
    const id = this.vaultId(key);
    const existed = (await this.metadata.get(id)) !== undefined;
    if (existed) {
      await this.metadata.delete(id);
      await this.vault.deleteSecret(id);
    }
    return existed;
  }

  async has(key: string): Promise<boolean> {
    const row = await this.metadata.get(this.vaultId(key));
    if (!row) return false;
    if (this.isExpired(row)) {
      await this.delete(key);
      return false;
    }
    return true;
  }

  async keys(): Promise<readonly string[]> {
    return (await this.listMetadata()).map((m) => m.key);
  }

  async deleteAll(): Promise<void> {
    for (const m of await this.listMetadata()) {
      await this.delete(m.key);
    }
  }

  /** Metadata for every non-expired credential in this project scope. */
  async listMetadata(): Promise<CredentialMetadataInfo[]> {
    const all = await this.metadata.getAll();
    if (!all) return [];
    const out: CredentialMetadataInfo[] = [];
    for (const entry of all) {
      const row = entry.value;
      if (row.userId !== this.userId || row.projectId !== this.projectId) continue;
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

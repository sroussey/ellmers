/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialPutOptions, ICredentialStore } from "@workglow/util";
import { decrypt, encrypt } from "@workglow/util";
import type { IKvStorage } from "../kv/IKvStorage";

/**
 * Serialized form of a credential stored in the KV backend
 */
interface StoredCredential {
  readonly encrypted: string;
  readonly iv: string;
  readonly label: string | undefined;
  readonly provider: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | undefined;
}

/**
 * Reserved KV key holding a marker entry encrypted with the store's
 * passphrase. Used by {@link EncryptedKvCredentialStore.verifyPassphrase}
 * to detect mistyped passphrases before they silently encrypt new entries
 * under the wrong key and irreversibly diverge from existing entries.
 *
 * The sentinel is hidden from {@link EncryptedKvCredentialStore.keys},
 * {@link EncryptedKvCredentialStore.has}, and {@link EncryptedKvCredentialStore.delete};
 * {@link EncryptedKvCredentialStore.deleteAll} rewrites it after clearing.
 */
export const CREDSTORE_SENTINEL_KEY = "__credstore_sentinel__";

/**
 * Plaintext that is encrypted and stored under {@link CREDSTORE_SENTINEL_KEY}.
 * The exact value is irrelevant — AES-GCM authentication makes any deviation
 * fail decryption — but a stable string is useful for diagnostics.
 */
export const SENTINEL_PLAINTEXT = "workglow:credstore:v1";

/**
 * Outcome of a sentinel-based passphrase check.
 *
 * - `"match"`     — sentinel present and decrypts successfully; passphrase is correct.
 * - `"mismatch"`  — sentinel present but decryption fails (AES-GCM auth-tag failure).
 *                   The supplied passphrase does not match the one that wrote the sentinel.
 * - `"absent"`    — no sentinel row. Caller decides whether this is a first-time
 *                   init (write a sentinel) or a legacy migration (try decrypting
 *                   one existing row before committing to this passphrase).
 */
export type PassphraseVerification = "match" | "mismatch" | "absent";

/**
 * Credential store that encrypts values with AES-256-GCM before persisting
 * them to an {@link IKvStorage} backend.
 *
 * Works with any KV backend (SQLite, PostgreSQL, IndexedDB, in-memory, etc.).
 * Uses the Web Crypto API (available in Node 20+, Bun, and browsers).
 *
 * @example
 * ```ts
 * import { SqliteKvStorage } from "@workglow/storage";
 *
 * const kv = new SqliteKvStorage(":memory:");
 * const store = new EncryptedKvCredentialStore(kv, "my-encryption-key");
 *
 * await store.put("openai-api-key", "sk-...", { provider: "openai" });
 * const key = await store.get("openai-api-key"); // "sk-..."
 * ```
 */
export class EncryptedKvCredentialStore implements ICredentialStore {
  /** Per-instance cache of derived CryptoKey instances keyed by base64(salt). */
  private readonly keyCache = new Map<string, CryptoKey>();

  constructor(
    private readonly kv: IKvStorage<string, StoredCredential>,
    private readonly passphrase: string
  ) {
    if (!passphrase) {
      throw new Error("EncryptedKvCredentialStore requires a non-empty passphrase.");
    }
  }

  async get(key: string): Promise<string | undefined> {
    const raw = (await this.kv.get(key)) as StoredCredential | undefined;
    if (!raw) return undefined;

    if (raw.expiresAt && new Date(raw.expiresAt) <= new Date()) {
      await this.kv.delete(key);
      return undefined;
    }

    return decrypt(raw.encrypted, raw.iv, this.passphrase, this.keyCache);
  }

  /**
   * Encrypt {@link SENTINEL_PLAINTEXT} under the store's passphrase and
   * persist it at {@link CREDSTORE_SENTINEL_KEY}. Idempotent: a second call
   * overwrites the existing sentinel.
   */
  async writeSentinel(): Promise<void> {
    const now = new Date().toISOString();
    const { encrypted, iv } = await encrypt(SENTINEL_PLAINTEXT, this.passphrase, this.keyCache);
    const stored: StoredCredential = {
      encrypted,
      iv,
      label: undefined,
      provider: undefined,
      createdAt: now,
      updatedAt: now,
      expiresAt: undefined,
    };
    await this.kv.put(CREDSTORE_SENTINEL_KEY, stored);
  }

  /**
   * Check whether the store's passphrase matches the one that wrote the
   * sentinel.
   *
   * @see {@link PassphraseVerification}
   */
  async verifyPassphrase(): Promise<PassphraseVerification> {
    const raw = (await this.kv.get(CREDSTORE_SENTINEL_KEY)) as StoredCredential | undefined;
    if (!raw) return "absent";
    try {
      const plaintext = await decrypt(raw.encrypted, raw.iv, this.passphrase, this.keyCache);
      // Defense in depth: AES-GCM authentication already gates this, but
      // require the expected plaintext too so a future format bump is
      // detected explicitly rather than silently treated as a match.
      return plaintext === SENTINEL_PLAINTEXT ? "match" : "mismatch";
    } catch {
      // crypto.subtle.decrypt throws on AES-GCM auth-tag failure (the
      // signal for "wrong key / tampered ciphertext").
      return "mismatch";
    }
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    // The sentinel row is written exclusively by {@link writeSentinel} (and
    // overwritten by {@link deleteAll}). Allowing a caller to put() at this
    // key would replace the marker with attacker-chosen ciphertext under the
    // caller's passphrase and, on the next `verifyPassphrase()`, return
    // "match" even though the stored credentials use a different key. Reject
    // the write BEFORE touching the KV so the store stays unlockable.
    if (key === CREDSTORE_SENTINEL_KEY) {
      throw new Error("Cannot write to the reserved credential-store sentinel key.");
    }
    const now = new Date();
    const existing = (await this.kv.get(key)) as StoredCredential | undefined;

    const { encrypted, iv } = await encrypt(value, this.passphrase, this.keyCache);

    const stored: StoredCredential = {
      encrypted,
      iv,
      label: options?.label ?? existing?.label,
      provider: options?.provider ?? existing?.provider,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: options?.expiresAt ? options.expiresAt.toISOString() : existing?.expiresAt,
    };

    await this.kv.put(key, stored);
  }

  async delete(key: string): Promise<boolean> {
    // The sentinel is an implementation detail; callers must not be able to
    // remove it through the ICredentialStore surface.
    if (key === CREDSTORE_SENTINEL_KEY) return false;
    const exists = (await this.kv.get(key)) !== undefined;
    if (exists) {
      await this.kv.delete(key);
    }
    return exists;
  }

  async has(key: string): Promise<boolean> {
    if (key === CREDSTORE_SENTINEL_KEY) return false;
    const raw = (await this.kv.get(key)) as StoredCredential | undefined;
    if (!raw) return false;

    if (raw.expiresAt && new Date(raw.expiresAt) <= new Date()) {
      await this.kv.delete(key);
      return false;
    }
    return true;
  }

  async keys(): Promise<readonly string[]> {
    const all = await this.kv.getAll();
    if (!all) return [];

    const now = new Date();
    const result: string[] = [];
    for (const entry of all) {
      if (entry.key === CREDSTORE_SENTINEL_KEY) continue;
      if (entry.value.expiresAt && new Date(entry.value.expiresAt) <= now) {
        await this.kv.delete(entry.key);
        continue;
      }
      result.push(entry.key);
    }
    return result;
  }

  /**
   * Delete every credential in the store and rewrite the sentinel so the
   * passphrase verification path keeps working after the clear. (Without
   * the rewrite, the store would slip back into {@link PassphraseVerification}
   * `"absent"` and a subsequent mistyped passphrase could re-init the
   * store under the wrong key.)
   */
  async deleteAll(): Promise<void> {
    await this.kv.deleteAll();
    await this.writeSentinel();
  }
}

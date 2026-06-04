/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialPutOptions, ICredentialStore } from "@workglow/util";
import type { IKvStorage } from "../kv/IKvStorage";
import { CREDSTORE_SENTINEL_KEY, EncryptedKvCredentialStore } from "./EncryptedKvCredentialStore";

/**
 * An {@link ICredentialStore} wrapper that starts in a locked state and defers
 * construction of the underlying {@link EncryptedKvCredentialStore} until
 * {@link unlock} is called with a passphrase.
 *
 * **Locked behavior** (before {@link unlock}):
 * - `get()` returns `undefined` (falls through in a {@link ChainedCredentialStore})
 * - `has()` returns `false`
 * - `keys()` returns `[]`
 * - `put()` throws an error
 * - `delete()` returns `false`
 * - `deleteAll()` is a no-op
 *
 * **Unlocked behavior**: all methods delegate to the inner
 * {@link EncryptedKvCredentialStore}.
 *
 * @example
 * ```ts
 * const lazy = new LazyEncryptedCredentialStore(kvStorage);
 * await lazy.get("key"); // undefined (locked)
 *
 * await lazy.unlock("my-passphrase");
 * await lazy.get("key"); // decrypted value
 *
 * lazy.lock(); // discards inner store
 * await lazy.get("key"); // undefined again
 * ```
 */
export class LazyEncryptedCredentialStore implements ICredentialStore {
  private inner: EncryptedKvCredentialStore | undefined;

  constructor(private readonly kv: IKvStorage<string, unknown>) {}

  /**
   * Whether the store is currently unlocked and able to decrypt credentials.
   */
  get isUnlocked(): boolean {
    return this.inner !== undefined;
  }

  /**
   * Unlock the store by providing a passphrase. Verifies the passphrase
   * against a sentinel marker before assigning the inner store so a
   * mistyped passphrase cannot silently encrypt new entries under the
   * wrong key and diverge from existing entries.
   *
   * Behaviour by KV state:
   *  - **sentinel present + correct passphrase** → unlocks.
   *  - **sentinel present + wrong passphrase**   → throws
   *    `Invalid passphrase for credential store.`
   *  - **sentinel absent + empty KV**            → first-time init: write
   *    the sentinel and unlock.
   *  - **sentinel absent + non-empty KV (legacy migration)** → try to
   *    decrypt one existing row with this passphrase. Success → write
   *    the sentinel and unlock. Failure → throw (legacy rows present and
   *    the supplied passphrase cannot decrypt them, so accepting would
   *    silently fork the store).
   *
   * @throws if the passphrase is empty (`EncryptedKvCredentialStore`),
   *   does not decrypt the sentinel, or fails to decrypt any existing
   *   legacy row during migration.
   */
  async unlock(passphrase: string): Promise<void> {
    const candidate = new EncryptedKvCredentialStore(
      this.kv as IKvStorage<string, any>,
      passphrase
    );
    const verdict = await candidate.verifyPassphrase();
    if (verdict === "match") {
      this.inner = candidate;
      return;
    }
    if (verdict === "mismatch") {
      throw new Error("Invalid passphrase for credential store.");
    }
    // verdict === "absent" — either first-time init or legacy migration.
    const existing = await this.kv.getAll();
    const otherRows = existing
      ? existing.filter((entry) => entry.key !== CREDSTORE_SENTINEL_KEY)
      : [];
    if (otherRows.length === 0) {
      // First-time init: write the sentinel under the supplied passphrase.
      await candidate.writeSentinel();
      this.inner = candidate;
      return;
    }
    // Legacy migration: try decrypting one existing row to validate the
    // passphrase before committing.
    const probe = otherRows[0];
    try {
      const decrypted = await candidate.get(probe.key);
      if (decrypted === undefined) {
        // Row expired between getAll() and decrypt — treat as no-data init.
        await candidate.writeSentinel();
        this.inner = candidate;
        return;
      }
    } catch {
      // Existing rows present and the supplied passphrase cannot decrypt
      // them. Fail closed so we never silently fork the store.
      throw new Error(
        "Invalid passphrase for credential store: existing entries cannot be decrypted."
      );
    }
    // Probe row decrypted successfully — passphrase matches legacy data.
    // Write the sentinel so subsequent unlocks take the fast path.
    await candidate.writeSentinel();
    this.inner = candidate;
  }

  /**
   * Lock the store, discarding the inner {@link EncryptedKvCredentialStore}
   * and its derived key cache.
   */
  lock(): void {
    this.inner = undefined;
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.inner) return undefined;
    return this.inner.get(key);
  }

  async put(key: string, value: string, options?: CredentialPutOptions): Promise<void> {
    if (!this.inner) {
      throw new Error("Credential store is locked. Call unlock() before storing credentials.");
    }
    return this.inner.put(key, value, options);
  }

  async delete(key: string): Promise<boolean> {
    if (!this.inner) return false;
    return this.inner.delete(key);
  }

  async has(key: string): Promise<boolean> {
    if (!this.inner) return false;
    return this.inner.has(key);
  }

  async keys(): Promise<readonly string[]> {
    if (!this.inner) return [];
    return this.inner.keys();
  }

  async deleteAll(): Promise<void> {
    if (!this.inner) return;
    return this.inner.deleteAll();
  }
}

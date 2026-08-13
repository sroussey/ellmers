/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IKvStorage } from "@workglow/storage";
import { InMemoryKvStorage, LazyEncryptedCredentialStore } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it } from "vitest";

describe("LazyEncryptedCredentialStore", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let kv: InMemoryKvStorage;
  let store: LazyEncryptedCredentialStore;
  const passphrase = "test-passphrase-for-lazy-store";

  beforeEach(() => {
    kv = new InMemoryKvStorage();
    store = new LazyEncryptedCredentialStore(kv);
  });

  describe("locked behavior (before unlock)", () => {
    it("should start in a locked state", () => {
      expect(store.isUnlocked).toBe(false);
    });

    it("get() returns undefined when locked", async () => {
      expect(await store.get("any-key")).toBeUndefined();
    });

    it("has() returns false when locked", async () => {
      expect(await store.has("any-key")).toBe(false);
    });

    it("keys() returns empty array when locked", async () => {
      const keys = await store.keys();
      expect([...keys]).toEqual([]);
    });

    it("put() throws when locked", async () => {
      await expect(store.put("key", "value")).rejects.toThrow(/locked/);
    });

    it("delete() returns false when locked", async () => {
      expect(await store.delete("any-key")).toBe(false);
    });

    it("deleteAll() is a no-op when locked", async () => {
      await expect(store.deleteAll()).resolves.toBeUndefined();
    });
  });

  describe("unlock / lock transitions", () => {
    it("isUnlocked is true after unlock()", async () => {
      await store.unlock(passphrase);
      expect(store.isUnlocked).toBe(true);
    });

    it("isUnlocked is false after lock()", async () => {
      await store.unlock(passphrase);
      store.lock();
      expect(store.isUnlocked).toBe(false);
    });

    it("get() returns undefined again after re-locking", async () => {
      await store.unlock(passphrase);
      await store.put("key", "value");
      store.lock();
      expect(await store.get("key")).toBeUndefined();
    });

    it("can unlock, lock, and unlock again to access the same data", async () => {
      await store.unlock(passphrase);
      await store.put("key", "value");
      store.lock();

      await store.unlock(passphrase);
      expect(await store.get("key")).toBe("value");
    });
  });

  describe("unlocked behavior (delegates to EncryptedKvCredentialStore)", () => {
    beforeEach(async () => {
      await store.unlock(passphrase);
    });

    it("should store and retrieve a credential", async () => {
      await store.put("api-key", "sk-secret-12345");
      expect(await store.get("api-key")).toBe("sk-secret-12345");
    });

    it("should return undefined for missing keys", async () => {
      expect(await store.get("nonexistent")).toBeUndefined();
    });

    it("should report has() correctly", async () => {
      await store.put("key", "value");
      expect(await store.has("key")).toBe(true);
      expect(await store.has("nonexistent")).toBe(false);
    });

    it("should list all keys", async () => {
      await store.put("a", "1");
      await store.put("b", "2");
      const keys = await store.keys();
      expect([...keys].sort()).toEqual(["a", "b"]);
    });

    it("should delete a credential", async () => {
      await store.put("key", "value");
      expect(await store.delete("key")).toBe(true);
      expect(await store.get("key")).toBeUndefined();
    });

    it("should delete all credentials", async () => {
      await store.put("a", "1");
      await store.put("b", "2");
      await store.deleteAll();
      expect([...(await store.keys())]).toEqual([]);
    });

    it("should not decrypt with a different passphrase (fails at unlock)", async () => {
      await store.put("key", "secret");
      store.lock();

      const otherStore = new LazyEncryptedCredentialStore(kv);
      await expect(otherStore.unlock("wrong-passphrase")).rejects.toThrow(/Invalid passphrase/);
      expect(otherStore.isUnlocked).toBe(false);
    });
  });

  describe("passphrase sentinel (L-MAIN-03)", () => {
    it("first-time unlock on an empty KV writes the sentinel and succeeds", async () => {
      await store.unlock(passphrase);
      expect(store.isUnlocked).toBe(true);
      // Re-opening with the same passphrase against a fresh wrapper should
      // now take the sentinel-match fast path.
      const second = new LazyEncryptedCredentialStore(kv);
      await second.unlock(passphrase);
      expect(second.isUnlocked).toBe(true);
    });

    it("rejects a wrong passphrase at unlock time (not on first get())", async () => {
      await store.unlock(passphrase);
      await store.put("api-key", "sk-secret");
      store.lock();

      const wrong = new LazyEncryptedCredentialStore(kv);
      await expect(wrong.unlock("wrong-passphrase")).rejects.toThrow(/Invalid passphrase/);
      expect(wrong.isUnlocked).toBe(false);
    });

    it("migrates a legacy KV (no sentinel) when given the correct passphrase", async () => {
      const { EncryptedKvCredentialStore: Inner } = await import("@workglow/storage");
      // Simulate a legacy store: write one credential directly through the
      // inner store without ever calling unlock() on the lazy wrapper.
      const legacy = new Inner(kv as IKvStorage<string, any>, passphrase);
      await legacy.put("legacy-key", "legacy-value");

      // No sentinel yet — verifyPassphrase would return "absent" and the
      // wrapper takes the migration path.
      const lazy = new LazyEncryptedCredentialStore(kv);
      await lazy.unlock(passphrase);
      expect(lazy.isUnlocked).toBe(true);
      expect(await lazy.get("legacy-key")).toBe("legacy-value");

      // A second unlock with a wrong passphrase must now fail via the
      // sentinel that the migration wrote.
      lazy.lock();
      const wrong = new LazyEncryptedCredentialStore(kv);
      await expect(wrong.unlock("definitely-wrong")).rejects.toThrow(/Invalid passphrase/);
    });

    it("rejects a wrong passphrase against a legacy KV (fail closed)", async () => {
      const { EncryptedKvCredentialStore: Inner } = await import("@workglow/storage");
      const legacy = new Inner(kv as IKvStorage<string, any>, "real-passphrase");
      await legacy.put("legacy-key", "legacy-value");

      const lazy = new LazyEncryptedCredentialStore(kv);
      await expect(lazy.unlock("wrong-passphrase")).rejects.toThrow(/Invalid passphrase/);
      expect(lazy.isUnlocked).toBe(false);
    });

    it("hides the sentinel from keys()", async () => {
      await store.unlock(passphrase);
      await store.put("real-key", "value");
      const keys = await store.keys();
      expect([...keys]).toEqual(["real-key"]);
      // Should never leak the internal sentinel key name.
      expect([...keys]).not.toContain("__credstore_sentinel__");
    });

    it("hides the sentinel from has()", async () => {
      await store.unlock(passphrase);
      expect(await store.has("__credstore_sentinel__")).toBe(false);
    });

    it("deleteAll() rewrites the sentinel so future unlocks still verify", async () => {
      await store.unlock(passphrase);
      await store.put("k1", "v1");
      await store.deleteAll();
      expect([...(await store.keys())]).toEqual([]);
      store.lock();

      // A correct re-unlock must still succeed (sentinel was rewritten).
      const reopened = new LazyEncryptedCredentialStore(kv);
      await reopened.unlock(passphrase);
      expect(reopened.isUnlocked).toBe(true);

      // And a wrong passphrase must still be rejected.
      reopened.lock();
      const wrong = new LazyEncryptedCredentialStore(kv);
      await expect(wrong.unlock("wrong-passphrase")).rejects.toThrow(/Invalid passphrase/);
    });
  });
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryKvStorage, LazyEncryptedCredentialStore } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

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
    it("isUnlocked is true after unlock()", () => {
      store.unlock(passphrase);
      expect(store.isUnlocked).toBe(true);
    });

    it("isUnlocked is false after lock()", () => {
      store.unlock(passphrase);
      store.lock();
      expect(store.isUnlocked).toBe(false);
    });

    it("get() returns undefined again after re-locking", async () => {
      store.unlock(passphrase);
      await store.put("key", "value");
      store.lock();
      expect(await store.get("key")).toBeUndefined();
    });

    it("can unlock, lock, and unlock again to access the same data", async () => {
      store.unlock(passphrase);
      await store.put("key", "value");
      store.lock();

      store.unlock(passphrase);
      expect(await store.get("key")).toBe("value");
    });
  });

  describe("unlocked behavior (delegates to EncryptedKvCredentialStore)", () => {
    beforeEach(() => {
      store.unlock(passphrase);
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

    it("should not decrypt with a different passphrase", async () => {
      await store.put("key", "secret");
      store.lock();

      const otherStore = new LazyEncryptedCredentialStore(kv);
      otherStore.unlock("wrong-passphrase");
      await expect(otherStore.get("key")).rejects.toThrow();
    });
  });
});

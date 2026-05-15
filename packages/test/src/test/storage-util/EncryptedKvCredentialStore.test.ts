/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EncryptedKvCredentialStore, InMemoryKvStorage } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("EncryptedKvCredentialStore", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let kv: InMemoryKvStorage;
  let store: EncryptedKvCredentialStore;
  const passphrase = "test-passphrase-for-encryption";

  beforeEach(() => {
    kv = new InMemoryKvStorage();
    store = new EncryptedKvCredentialStore(kv, passphrase);
  });

  it("should throw if passphrase is empty", () => {
    expect(() => new EncryptedKvCredentialStore(kv, "")).toThrow("non-empty passphrase");
  });

  it("should store and retrieve a credential", async () => {
    await store.put("api-key", "sk-secret-12345");
    const retrieved = await store.get("api-key");
    expect(retrieved).toBe("sk-secret-12345");
  });

  it("should encrypt values in the underlying KV store", async () => {
    await store.put("api-key", "sk-secret-12345");
    // The raw value in KV should NOT be the plaintext
    const raw = await kv.get("api-key");
    expect(raw).toBeDefined();
    expect(raw.encrypted).toBeDefined();
    expect(raw.encrypted).not.toBe("sk-secret-12345");
    expect(raw.iv).toBeDefined();
  });

  it("should not decrypt with wrong passphrase", async () => {
    await store.put("api-key", "sk-secret");

    const wrongStore = new EncryptedKvCredentialStore(kv, "wrong-passphrase");
    await expect(wrongStore.get("api-key")).rejects.toThrow();
  });

  it("should return undefined for missing keys", async () => {
    expect(await store.get("nonexistent")).toBeUndefined();
  });

  it("should overwrite an existing credential", async () => {
    await store.put("key", "value1");
    await store.put("key", "value2");
    expect(await store.get("key")).toBe("value2");
  });

  it("should delete a credential", async () => {
    await store.put("key", "value");
    expect(await store.delete("key")).toBe(true);
    expect(await store.get("key")).toBeUndefined();
  });

  it("should return false when deleting a nonexistent key", async () => {
    expect(await store.delete("nonexistent")).toBe(false);
  });

  it("should check existence with has()", async () => {
    await store.put("key", "value");
    expect(await store.has("key")).toBe(true);
    expect(await store.has("nonexistent")).toBe(false);
  });

  it("should list all keys", async () => {
    await store.put("a", "1");
    await store.put("b", "2");
    await store.put("c", "3");
    const keys = await store.keys();
    expect([...keys].sort()).toEqual(["a", "b", "c"]);
  });

  it("should delete all credentials", async () => {
    await store.put("a", "1");
    await store.put("b", "2");
    await store.deleteAll();
    expect(await store.keys()).toEqual([]);
  });

  it("should handle expired credentials", async () => {
    const pastDate = new Date(Date.now() - 1000);
    await store.put("expired", "secret", { expiresAt: pastDate });
    expect(await store.get("expired")).toBeUndefined();
    expect(await store.has("expired")).toBe(false);
  });

  it("should return non-expired credentials", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    await store.put("valid", "secret", { expiresAt: futureDate });
    expect(await store.get("valid")).toBe("secret");
  });

  it("should store metadata alongside encrypted value", async () => {
    await store.put("key", "secret", { label: "My API Key", provider: "openai" });
    const raw = await kv.get("key");
    expect(raw.label).toBe("My API Key");
    expect(raw.provider).toBe("openai");
  });
});

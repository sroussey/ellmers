/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { InMemoryKvStorage } from "../kv/InMemoryKvStorage";
import { ServerCredentialStore, type CredentialMetadataRow } from "./ServerCredentialStore";
import type { SecretVault } from "./SecretVault";

function makeVault(): SecretVault {
  const map = new Map<string, string>();
  return {
    async setSecret(id, v) { map.set(id, v); },
    async getSecret(id) { return map.get(id); },
    async deleteSecret(id) { map.delete(id); },
  };
}

function makeStore() {
  const meta = new InMemoryKvStorage<string, CredentialMetadataRow>();
  const vault = makeVault();
  const store = new ServerCredentialStore({ vault, metadata: meta, userId: "u1", projectId: "p1" });
  return { store, meta, vault };
}

describe("ServerCredentialStore", () => {
  it("put then get round-trips the secret", async () => {
    const { store } = makeStore();
    await store.put("openai", "sk-123", { provider: "openai", label: "OpenAI" });
    expect(await store.get("openai")).toBe("sk-123");
  });

  it("has reflects presence; keys lists keys without values", async () => {
    const { store } = makeStore();
    await store.put("openai", "sk-123");
    expect(await store.has("openai")).toBe(true);
    expect(await store.has("missing")).toBe(false);
    expect(await store.keys()).toEqual(["openai"]);
  });

  it("delete removes both secret and metadata", async () => {
    const { store, vault } = makeStore();
    await store.put("openai", "sk-123");
    expect(await store.delete("openai")).toBe(true);
    expect(await store.get("openai")).toBeUndefined();
    expect(await vault.getSecret("u1/p1/openai")).toBeUndefined();
    expect(await store.delete("openai")).toBe(false);
  });

  it("expired credentials are not returned and are evicted", async () => {
    const { store } = makeStore();
    await store.put("temp", "v", { expiresAt: new Date(Date.now() - 1000) });
    expect(await store.get("temp")).toBeUndefined();
    expect(await store.has("temp")).toBe(false);
  });

  it("listMetadata returns metadata only, never values", async () => {
    const { store } = makeStore();
    await store.put("openai", "sk-123", { provider: "openai", label: "OpenAI" });
    const list = await store.listMetadata();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: "openai", provider: "openai", label: "OpenAI" });
    expect(JSON.stringify(list)).not.toContain("sk-123");
  });

  it("deleteAll clears the project scope", async () => {
    const { store } = makeStore();
    await store.put("a", "1");
    await store.put("b", "2");
    await store.deleteAll();
    expect(await store.keys()).toEqual([]);
  });

  it("isolates by project scope", async () => {
    const meta = new InMemoryKvStorage<string, CredentialMetadataRow>();
    const vault = makeVault();
    const p1 = new ServerCredentialStore({ vault, metadata: meta, userId: "u1", projectId: "p1" });
    const p2 = new ServerCredentialStore({ vault, metadata: meta, userId: "u1", projectId: "p2" });
    await p1.put("k", "v1");
    await p2.put("k", "v2");
    expect(await p1.get("k")).toBe("v1");
    expect(await p2.get("k")).toBe("v2");
    expect(await p1.keys()).toEqual(["k"]);
  });

  it("isolates by user scope", async () => {
    const meta = new InMemoryKvStorage<string, CredentialMetadataRow>();
    const vault = makeVault();
    const u1 = new ServerCredentialStore({ vault, metadata: meta, userId: "u1", projectId: "p1" });
    const u2 = new ServerCredentialStore({ vault, metadata: meta, userId: "u2", projectId: "p1" });
    await u1.put("k", "v1");
    await u2.put("k", "v2");
    expect(await u1.get("k")).toBe("v1");
    expect(await u2.get("k")).toBe("v2");
    expect(await u1.keys()).toEqual(["k"]);
    expect(await u1.listMetadata()).toHaveLength(1);
  });

  it("deleteAll clears expired entries too", async () => {
    const { store, meta } = makeStore();
    await store.put("live", "v");
    await store.put("dead", "v", { expiresAt: new Date(Date.now() - 1000) });
    await store.deleteAll();
    const remaining = (await meta.getAll()) ?? [];
    expect(remaining).toHaveLength(0);
  });
});

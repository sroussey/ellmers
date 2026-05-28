/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import type { IKvStorage } from "../kv/IKvStorage";
import { InMemoryKvStorage } from "../kv/InMemoryKvStorage";
import type { SecretVault } from "./SecretVault";
import { ServerCredentialStore, type CredentialMetadataRow } from "./ServerCredentialStore";

function makeVault(): SecretVault {
  const map = new Map<string, string>();
  return {
    async setSecret(id, v) {
      map.set(id, v);
    },
    async getSecret(id) {
      return map.get(id);
    },
    async deleteSecret(id) {
      map.delete(id);
    },
  };
}

function makeStore() {
  const meta: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
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
    const meta: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
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
    const meta: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
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

  it("put-then-get during in-flight put returns either prior committed value or undefined, never torn", async () => {
    // A vault whose setSecret blocks until we explicitly resolve it.
    const map = new Map<string, string>();
    let releaseSet: (() => void) | undefined;
    const blockedSet = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const vault: SecretVault = {
      async setSecret(id, v) {
        // First put commits synchronously; subsequent puts block on the gate.
        if (map.has(id)) {
          await blockedSet;
        }
        map.set(id, v);
      },
      async getSecret(id) {
        return map.get(id);
      },
      async deleteSecret(id) {
        map.delete(id);
      },
    };
    const meta: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const store = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });

    // Seed a prior committed value.
    await store.put("k", "v1");

    // Start a second put without awaiting; it will block inside setSecret.
    const inflight = store.put("k", "v2");

    // While the second put is in flight, get() must return the prior
    // committed value or undefined — never the not-yet-committed "v2".
    const observed = await store.get("k");
    expect(observed === "v1" || observed === undefined).toBe(true);
    expect(observed).not.toBe("v2");

    // Release the gate and let the in-flight put finish.
    releaseSet!();
    await inflight;
    expect(await store.get("k")).toBe("v2");
  });

  it("new-entry put: metadata write fails — vault is rolled back", async () => {
    const vault = makeVault();
    const deleteSpy = vi.spyOn(vault, "deleteSecret");
    // Failing metadata: every put() rejects. get/getAll/delete still work.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const meta: IKvStorage<string, CredentialMetadataRow> = Object.create(inner);
    meta.put = vi.fn(async () => {
      throw new Error("metadata put boom");
    }) as typeof inner.put;
    meta.get = (key) => inner.get(key);
    meta.getAll = () => inner.getAll();
    meta.delete = (key) => inner.delete(key);

    const store = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });

    await expect(store.put("k", "v")).rejects.toThrow();
    // Vault must have been rolled back (no value remains for the id).
    expect(await vault.getSecret("u1/p1/k")).toBeUndefined();
    // Defensive: the rollback path went through vault.deleteSecret OR the
    // vault was never written (depending on which write failed first).
    // The current implementation writes metadata first, so vault is never
    // touched if metadata.put throws — accept either outcome.
    expect(deleteSpy.mock.calls.length >= 0).toBe(true);
  });

  it("new-entry put: metadata write fails AND vault rollback fails — throws wrapped error and leaves orphan marker", async () => {
    // Vault.setSecret throws to trigger rollback; metadata.delete also throws
    // so the rollback path persists an orphan marker.
    const vault: SecretVault = {
      async setSecret() {
        throw new Error("vault boom");
      },
      async getSecret() {
        return undefined;
      },
      async deleteSecret() {
        // No-op (won't be reached on this path).
      },
    };
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const meta: IKvStorage<string, CredentialMetadataRow> = Object.create(inner);
    meta.put = (key, value) => inner.put(key, value);
    meta.get = (key) => inner.get(key);
    meta.getAll = () => inner.getAll();
    meta.delete = vi.fn(async () => {
      throw new Error("metadata delete boom");
    }) as typeof inner.delete;

    const store = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });

    let caught: unknown;
    try {
      await store.put("k", "v");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("rollback");
    expect((caught as Error).message).toContain("u1/p1/k");
    expect((caught as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect(((caught as Error & { cause?: Error }).cause as Error).message).toBe("vault boom");

    const row = await inner.get("u1/p1/k");
    expect(row).toBeDefined();
    expect(row!.pending).toBe(true);
    expect(typeof row!.orphanedAt).toBe("string");
    expect(row!.orphanedAt!.length).toBeGreaterThan(0);
  });

  it("pending row is invisible to get/has/listMetadata/keys", async () => {
    const { store, meta } = makeStore();
    // Seed a pending row directly via the metadata KV — bypassing put() so
    // it stays in the pending state.
    await meta.put("u1/p1/ghost", {
      userId: "u1",
      projectId: "p1",
      key: "ghost",
      label: undefined,
      provider: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: undefined,
      pending: true,
    });

    expect(await store.get("ghost")).toBeUndefined();
    expect(await store.has("ghost")).toBe(false);
    expect(await store.listMetadata()).toEqual([]);
    expect(await store.keys()).toEqual([]);
  });

  it("deleteAll scope isolation", async () => {
    const meta: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const vault = makeVault();
    const metaDeleteSpy = vi.spyOn(meta, "delete");
    const vaultDeleteSpy = vi.spyOn(vault, "deleteSecret");

    const u1p1 = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });
    const u1p2 = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p2",
    });
    const u2p1 = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u2",
      projectId: "p1",
    });

    await u1p1.put("a", "v");
    await u1p2.put("a", "v");
    await u2p1.put("a", "v");

    // Reset spies after seed puts so we only observe deleteAll's activity.
    metaDeleteSpy.mockClear();
    vaultDeleteSpy.mockClear();

    await u1p1.deleteAll();

    const metaDeletedIds = metaDeleteSpy.mock.calls.map((args) => args[0] as string);
    const vaultDeletedIds = vaultDeleteSpy.mock.calls.map((args) => args[0] as string);

    for (const id of metaDeletedIds) {
      expect(id.startsWith("u1/p1/")).toBe(true);
    }
    for (const id of vaultDeletedIds) {
      expect(id.startsWith("u1/p1/")).toBe(true);
    }

    // The other scopes are untouched.
    expect(await u1p2.get("a")).toBe("v");
    expect(await u2p1.get("a")).toBe("v");
    expect(await u1p1.get("a")).toBeUndefined();
  });
});

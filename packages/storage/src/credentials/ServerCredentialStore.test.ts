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

  it("delete removes both secret and metadata (metadata BEFORE vault)", async () => {
    const { store, meta, vault } = makeStore();
    await store.put("openai", "sk-123");

    // Record the order of side-effecting calls during delete only.
    const order: string[] = [];
    const metaDeleteSpy = vi.spyOn(meta, "delete").mockImplementation(async (k) => {
      order.push(`meta.delete:${String(k)}`);
      // Fall through to the real delete by calling the prototype's method on the
      // underlying instance. We rebind through Object.getPrototypeOf since the
      // spy replaces the own-property.
      return InMemoryKvStorage.prototype.delete.call(meta, k);
    });
    const vaultDeleteSpy = vi.spyOn(vault, "deleteSecret").mockImplementation(async (id) => {
      order.push(`vault.deleteSecret:${id}`);
    });

    expect(await store.delete("openai")).toBe(true);

    // Metadata must be deleted strictly before the vault.
    expect(order).toEqual(["meta.delete:u1/p1/openai", "vault.deleteSecret:u1/p1/openai"]);
    expect(metaDeleteSpy).toHaveBeenCalledTimes(1);
    expect(vaultDeleteSpy).toHaveBeenCalledTimes(1);

    expect(await store.get("openai")).toBeUndefined();
    // vault.deleteSecret was mocked above (no-op for the real map); restore and
    // assert the second delete is a clean miss.
    vaultDeleteSpy.mockRestore();
    metaDeleteSpy.mockRestore();
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

  it("update-in-flight: a concurrent get() returns the prior committed value (never the not-yet-committed new value, never undefined)", async () => {
    // A vault whose setSecret blocks until we explicitly resolve it, but only
    // for ids that already have a value (i.e., updates, not the initial seed).
    const map = new Map<string, string>();
    let releaseSet: (() => void) | undefined;
    const blockedSet = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const vault: SecretVault = {
      async setSecret(id, v) {
        // First put commits synchronously; subsequent puts block on the gate
        // BEFORE writing the map, so map still holds the prior value while
        // the in-flight put is suspended.
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

    // Seed a prior committed value (this is now an existing-row update on the
    // second put — metadata is non-pending so get() must succeed).
    await store.put("k", "v1");

    // Start a second put without awaiting; it will block inside setSecret.
    const inflight = store.put("k", "v2");

    // While the update is in flight, get() must return the OLD vault value
    // (metadata is committed and non-pending; vault.setSecret hasn't yet
    // written the new value because it's blocked on the gate). Critically:
    // not the new value, and not undefined.
    const observed = await store.get("k");
    expect(observed).toBe("v1");

    // Release the gate and let the in-flight put finish.
    releaseSet!();
    await inflight;
    expect(await store.get("k")).toBe("v2");
  });

  it("new-entry put: metadata write fails — vault is never touched", async () => {
    const vault = makeVault();
    const deleteSpy = vi.spyOn(vault, "deleteSecret");
    const setSpy = vi.spyOn(vault, "setSecret");
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
    // Vault must hold no value (the implementation writes metadata first, so
    // a metadata.put failure on a NEW entry never reaches vault.setSecret).
    expect(await vault.getSecret("u1/p1/k")).toBeUndefined();
    expect(setSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("new-entry put: metadata write fails AND vault rollback fails — throws wrapped error and leaves orphan marker with orphanReason vault-write-failed", async () => {
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
    expect(row!.orphanReason).toBe("vault-write-failed");
  });

  it("new-entry put: commit-step metadata write fails — vault retained, orphan marker persisted with orphanReason metadata-commit-failed, wrapped error thrown", async () => {
    // First metadata.put (pending:true) succeeds; vault.setSecret succeeds;
    // second metadata.put (commit pending:false) throws; third metadata.put
    // (orphan marker) succeeds.
    const vault = makeVault();
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    let putCount = 0;
    const meta: IKvStorage<string, CredentialMetadataRow> = Object.create(inner);
    meta.put = vi.fn(async (key: string, value: CredentialMetadataRow) => {
      putCount++;
      if (putCount === 2) throw new Error("commit boom");
      return inner.put(key, value);
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

    let caught: unknown;
    try {
      await store.put("k", "v");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("commit failed");
    expect((caught as Error).message).toContain("u1/p1/k");
    expect((caught as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect(((caught as Error & { cause?: Error }).cause as Error).message).toBe("commit boom");

    // Vault still holds the bytes — commit-step failures do not roll back.
    expect(await vault.getSecret("u1/p1/k")).toBe("v");
    // Metadata row is a sticky orphan marker tagged with the commit-failure reason.
    const row = await inner.get("u1/p1/k");
    expect(row).toBeDefined();
    expect(row!.pending).toBe(true);
    expect(typeof row!.orphanedAt).toBe("string");
    expect(row!.orphanedAt!.length).toBeGreaterThan(0);
    expect(row!.orphanReason).toBe("metadata-commit-failed");
  });

  it("delete(): vault delete fails after metadata delete — sticky orphan marker written with orphanReason vault-delete-failed, get/has/keys report absent, error thrown wraps vault cause", async () => {
    // Seed via the normal path, then swap vault.deleteSecret to throw.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const map = new Map<string, string>();
    const vault: SecretVault = {
      async setSecret(id, v) {
        map.set(id, v);
      },
      async getSecret(id) {
        return map.get(id);
      },
      async deleteSecret(id) {
        // Default: real behaviour. Swapped below before invoking delete.
        map.delete(id);
      },
    };
    const store = new ServerCredentialStore({
      vault,
      metadata: inner,
      userId: "u1",
      projectId: "p1",
    });
    await store.put("k", "v");

    // Replace vault.deleteSecret with a throwing implementation.
    vault.deleteSecret = vi.fn(async () => {
      throw new Error("vault delete boom");
    });

    let caught: unknown;
    try {
      await store.delete("k");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("metadata removed but vault delete failed");
    expect((caught as Error).message).toContain("u1/p1/k");
    expect((caught as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect(((caught as Error & { cause?: Error }).cause as Error).message).toBe(
      "vault delete boom"
    );

    // Orphan marker exists, with the right discriminator and pending:true.
    const row = await inner.get("u1/p1/k");
    expect(row).toBeDefined();
    expect(row!.pending).toBe(true);
    expect(row!.orphanReason).toBe("vault-delete-failed");
    expect(typeof row!.orphanedAt).toBe("string");
    expect(row!.orphanedAt!.length).toBeGreaterThan(0);

    // Readers report the key as absent despite the marker row existing.
    expect(await store.get("k")).toBeUndefined();
    expect(await store.has("k")).toBe(false);
    expect(await store.keys()).toEqual([]);
    expect(await store.listMetadata()).toEqual([]);
  });

  it("delete(): metadata delete fails — row remains readable, vault untouched, error propagates", async () => {
    const vault = makeVault();
    const vaultDeleteSpy = vi.spyOn(vault, "deleteSecret");

    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const meta: IKvStorage<string, CredentialMetadataRow> = Object.create(inner);
    // Seed via the inner first by routing put/get/getAll/delete through. We
    // need delete to fail ONLY after the seed put has committed.
    let deleteShouldFail = false;
    meta.put = (key, value) => inner.put(key, value);
    meta.get = (key) => inner.get(key);
    meta.getAll = () => inner.getAll();
    meta.delete = vi.fn(async (key: string) => {
      if (deleteShouldFail) throw new Error("metadata delete boom");
      return inner.delete(key);
    }) as typeof inner.delete;

    const store = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });

    await store.put("k", "v");
    // Now arm the failure for the upcoming delete.
    deleteShouldFail = true;
    vaultDeleteSpy.mockClear();

    await expect(store.delete("k")).rejects.toThrow("metadata delete boom");

    // Vault must not have been touched — metadata-first ordering means a
    // metadata.delete failure aborts before vault.deleteSecret runs.
    expect(vaultDeleteSpy).not.toHaveBeenCalled();

    // The row is still readable: the seeded value is intact.
    deleteShouldFail = false; // allow subsequent reads via underlying delete if needed
    expect(await store.get("k")).toBe("v");
    expect(await store.has("k")).toBe(true);
    expect(await vault.getSecret("u1/p1/k")).toBe("v");
  });

  it("deleteAll(): one id's vault delete fails — other ids complete, failing id has orphan marker, AggregateError thrown with that cause", async () => {
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const map = new Map<string, string>();
    const vault: SecretVault = {
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
    const store = new ServerCredentialStore({
      vault,
      metadata: inner,
      userId: "u1",
      projectId: "p1",
    });

    await store.put("a", "1");
    await store.put("bad", "2");
    await store.put("c", "3");

    // Make vault.deleteSecret fail for "bad" only.
    vault.deleteSecret = vi.fn(async (id: string) => {
      if (id === "u1/p1/bad") throw new Error("vault delete boom for bad");
      map.delete(id);
    });

    let caught: unknown;
    try {
      await store.deleteAll();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const agg = caught as AggregateError;
    expect(agg.message).toContain("orphan markers persisted");
    expect(agg.errors).toHaveLength(1);
    const inner0 = agg.errors[0] as Error;
    expect(inner0).toBeInstanceOf(Error);
    expect(inner0.message).toContain("metadata removed but vault delete failed");
    expect((inner0 as Error & { cause?: Error }).cause?.message).toBe(
      "vault delete boom for bad"
    );

    // The "good" ids are fully gone (metadata + vault).
    expect(await inner.get("u1/p1/a")).toBeUndefined();
    expect(await inner.get("u1/p1/c")).toBeUndefined();
    expect(map.has("u1/p1/a")).toBe(false);
    expect(map.has("u1/p1/c")).toBe(false);

    // The "bad" id has a sticky orphan marker.
    const badRow = await inner.get("u1/p1/bad");
    expect(badRow).toBeDefined();
    expect(badRow!.pending).toBe(true);
    expect(badRow!.orphanReason).toBe("vault-delete-failed");

    // Readers report no surviving keys (orphan marker is invisible).
    expect(await store.keys()).toEqual([]);
  });

  it("legacy orphan row without orphanReason is still invisible to readers", async () => {
    // Simulate persisted state from before the orphanReason discriminator
    // shipped: an orphan marker with orphanedAt but no orphanReason.
    const { store, meta } = makeStore();
    await meta.put("u1/p1/legacy", {
      userId: "u1",
      projectId: "p1",
      key: "legacy",
      label: undefined,
      provider: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: undefined,
      pending: true,
      orphanedAt: new Date().toISOString(),
      // orphanReason intentionally omitted (legacy row).
    });

    expect(await store.get("legacy")).toBeUndefined();
    expect(await store.has("legacy")).toBe(false);
    expect(await store.listMetadata()).toEqual([]);
    expect(await store.keys()).toEqual([]);
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

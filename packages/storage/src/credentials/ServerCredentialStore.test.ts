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

  it("delete removes both secret and metadata, metadata first", async () => {
    const { store, meta, vault } = makeStore();
    await store.put("openai", "sk-123");

    // Spy on the order of meta.delete vs vault.deleteSecret. The deleteById
    // contract is metadata-first so a vault-side throw cannot leave a row
    // that returns `undefined` from get(). vi.spyOn preserves call ordering
    // across spies via a single underlying invocationCallOrder counter.
    const metaDeleteSpy = vi.spyOn(meta, "delete");
    const vaultDeleteSpy = vi.spyOn(vault, "deleteSecret");

    expect(await store.delete("openai")).toBe(true);

    expect(metaDeleteSpy).toHaveBeenCalledTimes(1);
    expect(vaultDeleteSpy).toHaveBeenCalledTimes(1);
    // Metadata deletion must precede vault deletion. Using
    // `invocationCallOrder` on each first call is the cross-spy ordering
    // primitive vitest exposes.
    expect(metaDeleteSpy.mock.invocationCallOrder[0]).toBeLessThan(
      vaultDeleteSpy.mock.invocationCallOrder[0]
    );

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
    // Discriminator pin-down so operator tooling can match on the failure path.
    expect(row!.orphanReason).toBe("vault-write-failed");
  });

  it("new-entry put: commit-step metadata write fails — vault retained, orphan marker persisted, wrapped error thrown", async () => {
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
    // Metadata row is a sticky orphan marker.
    const row = await inner.get("u1/p1/k");
    expect(row).toBeDefined();
    expect(row!.pending).toBe(true);
    expect(typeof row!.orphanedAt).toBe("string");
    expect(row!.orphanedAt!.length).toBeGreaterThan(0);
    expect(row!.orphanReason).toBe("metadata-commit-failed");
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

  // ---------------------------------------------------------------------------
  // Key-injection hardening: the SAFE_SEGMENT grammar gates userId, projectId,
  // and every key that flows into vaultId(). These tests cover both the public
  // API surface (put/get/delete/has) and the constructor.
  // ---------------------------------------------------------------------------

  it("rejects a key containing a slash with TypeError (closes scope-escape via vault id)", async () => {
    const { store } = makeStore();
    // A slash would synthesise `u1/p1/../../other-user/other-project/leaked`
    // and collide with a vault id outside this scope.
    await expect(store.put("../../u2/p1/leak", "v")).rejects.toBeInstanceOf(TypeError);
    await expect(store.get("../../u2/p1/leak")).rejects.toBeInstanceOf(TypeError);
    await expect(store.delete("../../u2/p1/leak")).rejects.toBeInstanceOf(TypeError);
    await expect(store.has("../../u2/p1/leak")).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects an empty key with TypeError", async () => {
    const { store } = makeStore();
    await expect(store.put("", "v")).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects an oversized key (>128 chars) with TypeError", async () => {
    const { store } = makeStore();
    // The grammar caps segment length at 128. A 129-char key must reject so
    // the joined vault id cannot blow past common KV/file-system limits.
    const tooLong = "a".repeat(129);
    await expect(store.put(tooLong, "v")).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects a userId or projectId containing a slash at construction time", async () => {
    const vault = makeVault();
    const meta: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    expect(
      () =>
        new ServerCredentialStore({
          vault,
          metadata: meta,
          userId: "u1/escape",
          projectId: "p1",
        })
    ).toThrow(TypeError);
    expect(
      () =>
        new ServerCredentialStore({
          vault,
          metadata: meta,
          userId: "u1",
          projectId: "p1/escape",
        })
    ).toThrow(TypeError);
  });

  // ---------------------------------------------------------------------------
  // deleteById / delete failure modes
  // ---------------------------------------------------------------------------

  it("delete on a pending row returns false without touching the vault (closes orphan-overwrite and put/delete race)", async () => {
    // Seed a pending row directly so deleteById's pending-skip branch fires.
    // The matching vault entry simulates an in-flight new-entry put() whose
    // vault.setSecret has already taken effect but whose metadata commit
    // hasn't yet flipped pending off.
    const { store, meta, vault } = makeStore();
    await vault.setSecret("u1/p1/ghost", "ghost-bytes");
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
    const vaultDeleteSpy = vi.spyOn(vault, "deleteSecret");

    expect(await store.delete("ghost")).toBe(false);
    expect(vaultDeleteSpy).not.toHaveBeenCalled();
    // The pending row and the vault bytes remain untouched.
    expect(await vault.getSecret("u1/p1/ghost")).toBe("ghost-bytes");
    expect((await meta.get("u1/p1/ghost"))!.pending).toBe(true);
  });

  it("delete with vault-fail writes orphan marker and surfaces wrapped error with cause chain", async () => {
    // Vault.deleteSecret throws; metadata.put for the orphan marker succeeds.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const vault: SecretVault = {
      async setSecret(id, v) {
        // Used by the seed put() below — proxy to a real underlying map so
        // the seeded value is observable.
        seedMap.set(id, v);
      },
      async getSecret(id) {
        return seedMap.get(id);
      },
      async deleteSecret() {
        throw new Error("vault delete boom");
      },
    };
    const seedMap = new Map<string, string>();

    const store = new ServerCredentialStore({
      vault,
      metadata: inner,
      userId: "u1",
      projectId: "p1",
    });
    await store.put("k", "v");

    let caught: unknown;
    try {
      await store.delete("k");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("vault delete failed");
    expect((caught as Error).message).toContain("orphan marker persisted");
    expect((caught as Error & { cause?: Error }).cause).toBeInstanceOf(Error);
    expect(((caught as Error & { cause?: Error }).cause as Error).message).toBe(
      "vault delete boom"
    );

    // Metadata is reinstated as a pending orphan marker with the discriminator.
    const row = await inner.get("u1/p1/k");
    expect(row).toBeDefined();
    expect(row!.pending).toBe(true);
    expect(typeof row!.orphanedAt).toBe("string");
    expect(row!.orphanReason).toBe("vault-delete-failed");
  });

  it("delete with vault-fail AND marker-write-fail surfaces a 'marker also failed to persist' message and does not crash", async () => {
    // Stage 1: seed via a working metadata KV so the row exists. Stage 2:
    // swap in a metadata wrapper whose `delete` succeeds (clearing the row)
    // but whose subsequent `put` throws (marker write fails). Vault.deleteSecret
    // throws too, so the marker-write path is reached.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const seedMap = new Map<string, string>();
    const vault: SecretVault = {
      async setSecret(id, v) {
        seedMap.set(id, v);
      },
      async getSecret(id) {
        return seedMap.get(id);
      },
      async deleteSecret() {
        throw new Error("vault delete boom");
      },
    };
    // Seed-phase store uses the unwrapped metadata KV so put() succeeds.
    const seedStore = new ServerCredentialStore({
      vault,
      metadata: inner,
      userId: "u1",
      projectId: "p1",
    });
    await seedStore.put("k", "v");

    // Delete-phase store sees a metadata layer that allows the initial get
    // and delete but rejects the marker put.
    const meta: IKvStorage<string, CredentialMetadataRow> = Object.create(inner);
    meta.get = (key) => inner.get(key);
    meta.getAll = () => inner.getAll();
    meta.delete = (key) => inner.delete(key);
    meta.put = vi.fn(async () => {
      throw new Error("marker put boom");
    }) as typeof inner.put;

    const store = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });

    let caught: unknown;
    try {
      await store.delete("k");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("vault delete failed");
    expect((caught as Error).message).toContain("orphan marker also failed to persist");
    // The original vault error is still in the cause chain.
    expect(((caught as Error & { cause?: Error }).cause as Error).message).toBe(
      "vault delete boom"
    );
    // Metadata is gone (delete succeeded) and no marker was written.
    expect(await inner.get("u1/p1/k")).toBeUndefined();
  });

  it("delete with metadata-fail leaves the vault untouched", async () => {
    // Metadata.delete throws on the path; the implementation must surface
    // the throw BEFORE calling vault.deleteSecret so the value stays readable.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const vault = makeVault();
    const seedStore = new ServerCredentialStore({
      vault,
      metadata: inner,
      userId: "u1",
      projectId: "p1",
    });
    await seedStore.put("k", "v");

    const vaultDeleteSpy = vi.spyOn(vault, "deleteSecret");

    const meta: IKvStorage<string, CredentialMetadataRow> = Object.create(inner);
    meta.get = (key) => inner.get(key);
    meta.getAll = () => inner.getAll();
    meta.put = (key, value) => inner.put(key, value);
    meta.delete = vi.fn(async () => {
      throw new Error("metadata delete boom");
    }) as typeof inner.delete;

    const store = new ServerCredentialStore({
      vault,
      metadata: meta,
      userId: "u1",
      projectId: "p1",
    });

    await expect(store.delete("k")).rejects.toThrow(/metadata delete boom/);
    // Vault is untouched: the metadata-first ordering ensures a failing
    // metadata delete cannot drop the vault entry.
    expect(vaultDeleteSpy).not.toHaveBeenCalled();
    expect(await vault.getSecret("u1/p1/k")).toBe("v");
  });

  // ---------------------------------------------------------------------------
  // deleteAll AggregateError
  // ---------------------------------------------------------------------------

  it("deleteAll throws AggregateError carrying every per-row failure", async () => {
    // Seed two rows; make vault.deleteSecret throw for one of them so a single
    // bad row does not silently mask deletion of the rest.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const seedMap = new Map<string, string>();
    const vault: SecretVault = {
      async setSecret(id, v) {
        seedMap.set(id, v);
      },
      async getSecret(id) {
        return seedMap.get(id);
      },
      async deleteSecret(id) {
        if (id === "u1/p1/dead") throw new Error("vault delete boom for dead");
        seedMap.delete(id);
      },
    };

    const store = new ServerCredentialStore({
      vault,
      metadata: inner,
      userId: "u1",
      projectId: "p1",
    });
    await store.put("alive", "1");
    await store.put("dead", "2");

    let caught: unknown;
    try {
      await store.deleteAll();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(1);
    expect(((caught as AggregateError).errors[0] as Error).message).toContain(
      "vault delete failed"
    );
    // The healthy row was still deleted — its metadata is gone and its vault
    // bytes are gone too.
    expect(await inner.get("u1/p1/alive")).toBeUndefined();
    expect(seedMap.get("u1/p1/alive")).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Race: concurrent put+delete on a new entry
  // ---------------------------------------------------------------------------

  it("concurrent put(new)+delete: delete during the pending window is a no-op so the put's vault write is not orphaned", async () => {
    // Gate vault.setSecret so the new-entry put() suspends AFTER writing its
    // pending metadata row but BEFORE the vault write completes. A concurrent
    // delete() observed against the pending row used to nuke the vault entry
    // mid-put; deleteById's pending-skip branch now makes that delete a no-op.
    const inner: IKvStorage<string, CredentialMetadataRow> = new InMemoryKvStorage();
    const map = new Map<string, string>();
    let releaseSet: (() => void) | undefined;
    const blockedSet = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const vault: SecretVault = {
      async setSecret(id, v) {
        await blockedSet;
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

    // Kick off the put without awaiting; it blocks inside setSecret with the
    // metadata row already written as `pending: true`.
    const inflightPut = store.put("k", "v");

    // Pending window: delete must return false and leave the vault untouched.
    const deleteResult = await store.delete("k");
    expect(deleteResult).toBe(false);

    // Release the gate; the put finishes its vault+commit hops successfully.
    releaseSet!();
    await inflightPut;

    // After the put commits, the secret is readable. No orphan was created.
    expect(await store.get("k")).toBe("v");
    expect(map.get("u1/p1/k")).toBe("v");
    const row = await inner.get("u1/p1/k");
    expect(row).toBeDefined();
    expect(row!.pending).not.toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Legacy orphan rows (no orphanReason set) stay invisible
  // ---------------------------------------------------------------------------

  it("legacy orphan rows without an orphanReason discriminator stay invisible to readers", async () => {
    // Simulate a row written before `orphanReason` existed: pending+orphanedAt
    // but no discriminator field. Readers should still treat it as absent.
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
      // orphanReason intentionally absent.
    });

    expect(await store.get("legacy")).toBeUndefined();
    expect(await store.has("legacy")).toBe(false);
    expect(await store.listMetadata()).toEqual([]);
    expect(await store.keys()).toEqual([]);
  });
});

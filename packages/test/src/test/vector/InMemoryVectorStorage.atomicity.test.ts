/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

// safeEmit re-throws caught listener errors via queueMicrotask so observability
// (unhandledException / unhandledrejection) is preserved. In the test process
// these rethrows would otherwise be treated as uncaught failures; absorb them
// so the explicit assertions remain the test signal.
if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("uncaughtException", () => {});
  process.on("unhandledRejection", () => {});
}

/**
 * Atomicity contract for the in-memory vector `putBulk`:
 *
 * The inherited tabular `putBulk` runs writes via `Promise.all`, so a
 * non-shape error mid-batch (PK collision, structured-clone failure,
 * listener throw) used to leave rows 0..N-1 committed. The vector override
 * snapshots mutable state, writes serially, and restores on throw so the
 * batch is all-or-nothing.
 */

const VecSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const VecPK = ["id"] as const;
const DIM = 3;

interface VecEntity {
  id: string;
  vector: Float32Array;
  metadata: Record<string, unknown>;
}

function newStore() {
  return new InMemoryVectorStorage<
    typeof VecSchema,
    typeof VecPK,
    Record<string, unknown>,
    VecEntity
  >(VecSchema, VecPK, [], DIM);
}

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("InMemoryVectorStorage putBulk atomicity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("putBulk rolls back all writes when a non-shape error fires mid-batch", async () => {
    const store = newStore();

    // Seed a pre-existing row that must survive the failed batch.
    await store.put({ id: "preexisting", vector: vec([0, 0, 1]), metadata: { keep: true } });

    // Save the original prototype put so the spy can delegate to it without
    // recursing into itself.
    const originalPut = InMemoryTabularStorage.prototype.put;

    let call = 0;
    const putSpy = vi
      .spyOn(InMemoryTabularStorage.prototype as any, "put")
      .mockImplementation(async function (this: InMemoryVectorStorage<any, any, any, any>, v: any) {
        call += 1;
        if (call === 2) {
          throw new Error("synthetic mid-batch failure");
        }
        return await (originalPut as any).call(this, v);
      } as any);

    const batch = [
      { id: "row-a", vector: vec([1, 0, 0]), metadata: {} },
      { id: "row-b", vector: vec([0, 1, 0]), metadata: {} },
      { id: "row-c", vector: vec([0, 0, 1]), metadata: {} },
    ];

    await expect(store.putBulk(batch)).rejects.toThrow("synthetic mid-batch failure");

    // Restore the spy before issuing further reads so `get` runs against the
    // original implementation (get is unrelated, but keeping the surface
    // restored avoids surprises).
    putSpy.mockRestore();

    // The pre-existing row must still be there.
    const survivor = await store.get({ id: "preexisting" });
    expect(survivor).toBeDefined();

    // None of the batch's rows should remain.
    expect(await store.get({ id: "row-a" })).toBeUndefined();
    expect(await store.get({ id: "row-b" })).toBeUndefined();
    expect(await store.get({ id: "row-c" })).toBeUndefined();

    // Total size: only the pre-existing row.
    expect(await store.size()).toBe(1);

    // The spy fired twice — once for the row that committed, once for the throw.
    expect(call).toBe(2);
  });

  it("emits a rollback event on the storage emitter when a batch fails", async () => {
    const store = newStore();

    vi.spyOn(InMemoryTabularStorage.prototype as any, "put").mockImplementation((async () => {
      throw new Error("boom");
    }) as any);

    const rollbackEvents: Array<{ op: string; error: unknown }> = [];
    // `on` is wired through BaseTabularStorage to the underlying EventEmitter.
    store.on("rollback" as any, (reason: any) => rollbackEvents.push(reason));

    await expect(
      store.putBulk([{ id: "x", vector: vec([1, 0, 0]), metadata: {} }])
    ).rejects.toThrow("boom");

    expect(rollbackEvents).toHaveLength(1);
    expect(rollbackEvents[0].op).toBe("putBulk");
    expect((rollbackEvents[0].error as Error).message).toBe("boom");
  });

  it("putBulk commits every row when nothing throws", async () => {
    const store = newStore();
    const batch = [
      { id: "row-1", vector: vec([1, 0, 0]), metadata: {} },
      { id: "row-2", vector: vec([0, 1, 0]), metadata: {} },
      { id: "row-3", vector: vec([0, 0, 1]), metadata: {} },
    ];

    const results = await store.putBulk(batch);
    expect(results).toHaveLength(3);
    expect(await store.size()).toBe(3);
  });

  it("does not mask the original batch error when a rollback listener throws", async () => {
    // A misbehaving rollback subscriber must not derail the throw of the
    // original batch error — that error is the signal callers rely on to
    // know writes were rolled back. `EventEmitter.emit` rethrows listener
    // errors synchronously, so the emit site is routed through `safeEmit`.
    const store = newStore();

    // Suppress the warning the safeEmit path logs for the thrown listener.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    store.on("rollback" as any, () => {
      throw new Error("listener boom");
    });

    vi.spyOn(InMemoryTabularStorage.prototype as any, "put").mockImplementation((async () => {
      throw new Error("original-error");
    }) as any);

    await expect(
      store.putBulk([{ id: "row-a", vector: vec([1, 0, 0]), metadata: {} }])
    ).rejects.toThrow("original-error");
  });

  it("still fires later rollback listeners when an earlier one throws", async () => {
    const store = newStore();

    vi.spyOn(console, "warn").mockImplementation(() => {});

    const seenByLater: Array<{ op: string; error: unknown }> = [];
    store.on("rollback" as any, () => {
      throw new Error("first listener boom");
    });
    store.on("rollback" as any, (reason: any) => {
      seenByLater.push(reason);
    });

    vi.spyOn(InMemoryTabularStorage.prototype as any, "put").mockImplementation((async () => {
      throw new Error("original-error");
    }) as any);

    await expect(
      store.putBulk([{ id: "row-a", vector: vec([1, 0, 0]), metadata: {} }])
    ).rejects.toThrow("original-error");

    expect(seenByLater).toHaveLength(1);
    expect(seenByLater[0].op).toBe("putBulk");
    expect((seenByLater[0].error as Error).message).toBe("original-error");
  });

  it("putBulk does not advance the autoincrement counter on failure", async () => {
    // Schema with auto-incremented integer PK so we can observe the counter
    // via the values it assigns to subsequent successful puts.
    const AutoSchema = {
      type: "object",
      properties: {
        id: { type: "integer", "x-auto-generated": true },
        vector: TypedArraySchema(),
        metadata: { type: "object", format: "metadata", additionalProperties: true },
      },
      required: ["id", "vector", "metadata"],
      additionalProperties: false,
    } as const satisfies DataPortSchemaObject;

    type AutoEntity = {
      id: number;
      vector: Float32Array;
      metadata: Record<string, unknown>;
    };

    const autoStore = new InMemoryVectorStorage<
      typeof AutoSchema,
      ["id"],
      Record<string, unknown>,
      AutoEntity
    >(AutoSchema, ["id"], [], DIM);

    // Successful seed → id should be 1.
    const seed = await autoStore.put({ vector: vec([1, 0, 0]), metadata: {} } as any);
    expect(seed.id).toBe(1);

    // Force a mid-batch failure on the second insert of a 3-row batch.
    const originalPut = InMemoryTabularStorage.prototype.put;
    let callCount = 0;
    const putSpy = vi
      .spyOn(InMemoryTabularStorage.prototype as any, "put")
      .mockImplementation(async function (this: InMemoryVectorStorage<any, any, any, any>, v: any) {
        callCount += 1;
        if (callCount === 2) throw new Error("mid-batch");
        return await (originalPut as any).call(this, v);
      } as any);

    await expect(
      autoStore.putBulk([
        { vector: vec([1, 0, 0]), metadata: {} } as any,
        { vector: vec([0, 1, 0]), metadata: {} } as any,
        { vector: vec([0, 0, 1]), metadata: {} } as any,
      ])
    ).rejects.toThrow("mid-batch");

    putSpy.mockRestore();

    // After rollback, only the seed row should remain.
    expect(await autoStore.size()).toBe(1);

    // The next successful put must take id 2 — proving the counter
    // was restored. Without rollback, the counter would have advanced
    // past 1 during the failed batch's first write.
    const next = await autoStore.put({ vector: vec([1, 1, 0]), metadata: {} } as any);
    expect(next.id).toBe(2);
  });
});

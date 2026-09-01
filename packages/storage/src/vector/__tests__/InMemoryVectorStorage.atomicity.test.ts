/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { TypedArraySchema } from "@workglow/util/schema";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
  // Two listener-throw tests below route through safeEmit, which forwards the
  // caught throw to the unhandledRejection channel for observability. Vitest
  // treats stray rejections as worker failures, so absorb only the two
  // literal messages these tests emit and rethrow anything else.
  const swallow = (e: unknown): void => {
    if (e instanceof Error && /listener boom|first listener boom/.test(e.message)) return;
    throw e;
  };
  beforeAll(() => {
    if (typeof process !== "undefined" && typeof process.on === "function") {
      process.on("unhandledRejection", swallow);
    }
  });
  afterAll(() => {
    if (typeof process !== "undefined" && typeof process.off === "function") {
      // bun-types 1.4 shadows `Process.off` with a memoryPressure-only overload;
      // the EventEmitter view still carries the generic one.
      (process as NodeJS.EventEmitter).off("unhandledRejection", swallow);
    }
  });

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

    // Track the rollback event so we can verify `ids` carries the row that
    // committed before the throw — without the list, subscribers would have
    // to re-read the whole table to know what changed.
    const rollbackEvents: Array<{ op: string; error: unknown; ids: readonly any[] }> = [];
    store.on("rollback" as any, (reason: any) => rollbackEvents.push(reason));

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

    // Rollback event names exactly the row that committed before the throw
    // (row-a), not row-b (which threw) or row-c (which never ran).
    expect(rollbackEvents).toHaveLength(1);
    expect(rollbackEvents[0].ids).toHaveLength(1);
    expect((rollbackEvents[0].ids[0] as { id: string }).id).toBe("row-a");
  });

  it("rollback event reports ids: [] when the first row throws", async () => {
    const store = newStore();

    vi.spyOn(InMemoryTabularStorage.prototype as any, "put").mockImplementation((async () => {
      throw new Error("first-row-boom");
    }) as any);

    const rollbackEvents: Array<{ op: string; error: unknown; ids: readonly any[] }> = [];
    store.on("rollback" as any, (reason: any) => rollbackEvents.push(reason));

    await expect(
      store.putBulk([
        { id: "row-a", vector: vec([1, 0, 0]), metadata: {} },
        { id: "row-b", vector: vec([0, 1, 0]), metadata: {} },
      ])
    ).rejects.toThrow("first-row-boom");

    expect(rollbackEvents).toHaveLength(1);
    // No row reached the Map before the throw, so `ids` is empty (the
    // payload signals "nothing committed to invalidate").
    expect(rollbackEvents[0].ids).toEqual([]);
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

    const rollbackEvents: Array<{ op: string; error: unknown; ids: readonly any[] }> = [];
    autoStore.on("rollback" as any, (reason: any) => rollbackEvents.push(reason));

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

    // The rollback event reports the auto-assigned id that the first call
    // produced before the second one threw. The id must be the concrete
    // value the counter assigned (2), not undefined — that's the whole
    // point of extracting the PK from the *committed* entity rather than
    // the user input that came in without an id.
    expect(rollbackEvents).toHaveLength(1);
    expect(rollbackEvents[0].ids).toHaveLength(1);
    expect((rollbackEvents[0].ids[0] as { id: number }).id).toBe(2);
  });

  it("putBulk rollback does not wipe concurrent put committed mid-batch", async () => {
    // Without the per-instance mutex serializing put/putBulk, a single-row
    // `put` issued while `putBulk` is mid-flight can land in the Map between
    // the snapshot and the rollback. The snapshot+restore would then wipe
    // the row the concurrent put just committed — a successful put would
    // appear to disappear. The mutex routes both calls through the same
    // promise chain so the concurrent put runs either fully before the
    // snapshot or fully after the restore.
    const store = newStore();

    // Gate row 2 inside the batch via a deferred promise so a concurrent
    // single-row put can fire while putBulk is parked.
    let releaseRow2!: () => void;
    const row2Gate = new Promise<void>((resolve) => {
      releaseRow2 = resolve;
    });

    const originalPut = InMemoryTabularStorage.prototype.put;
    let call = 0;
    vi.spyOn(InMemoryTabularStorage.prototype as any, "put").mockImplementation(async function (
      this: InMemoryVectorStorage<any, any, any, any>,
      v: any
    ) {
      call += 1;
      if (call === 2) {
        await row2Gate;
      }
      if (call === 4) {
        throw new Error("synthetic row-4 failure");
      }
      return await (originalPut as any).call(this, v);
    } as any);

    const batch = [
      { id: "row-a", vector: vec([1, 0, 0]), metadata: {} },
      { id: "row-b", vector: vec([0, 1, 0]), metadata: {} },
      { id: "row-c", vector: vec([0, 0, 1]), metadata: {} },
      { id: "row-d", vector: vec([1, 1, 0]), metadata: {} },
    ];

    // Kick off the batch — it parks at row 2.
    const bulkPromise = store.putBulk(batch);

    // While putBulk is parked, fire a concurrent put with id 99. The mutex
    // must queue it behind the bulk operation rather than letting it land
    // mid-batch where the rollback would erase it.
    const concurrentPut = store.put({ id: "row-99", vector: vec([0, 0, 1]), metadata: {} });

    // Release row 2 so the bulk advances to row 4 and throws.
    releaseRow2();

    await expect(bulkPromise).rejects.toThrow("synthetic row-4 failure");

    // The concurrent put queued behind the bulk must still resolve after
    // the rollback, with the row landing in storage.
    await concurrentPut;
    const survivor = await store.get({ id: "row-99" });
    expect(survivor).toBeDefined();

    // None of the batch rows should remain.
    expect(await store.get({ id: "row-a" })).toBeUndefined();
    expect(await store.get({ id: "row-b" })).toBeUndefined();
    expect(await store.get({ id: "row-c" })).toBeUndefined();
    expect(await store.get({ id: "row-d" })).toBeUndefined();

    // Exactly one row in storage: the concurrent put's row.
    expect(await store.size()).toBe(1);
  });
});

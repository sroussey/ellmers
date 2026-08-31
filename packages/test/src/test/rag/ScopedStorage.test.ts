/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createKnowledgeBase,
  getGlobalKnowledgeBaseRepository,
  isSharedTableMode,
  registerKnowledgeBase,
  ScopedTabularStorage,
  ScopedVectorStorage,
  SharedChunkIndexes,
  SharedChunkPrimaryKey,
  SharedChunkVectorStorageSchema,
  SharedDocumentIndexes,
  SharedDocumentPrimaryKey,
  SharedDocumentStorageSchema,
} from "@workglow/knowledge-base";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import type { ILogger } from "@workglow/util";
import { ConsoleLogger, getLogger, setLogger, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { report, snap } from "../../binding/testTiming";

let _snap = snap();
beforeEach(() => {
  _snap = snap();
});
afterEach(() => {
  report("scoped-store", _snap);
});

describe("ScopedTabularStorage", () => {
  let sharedStorage: InMemoryTabularStorage<
    typeof SharedDocumentStorageSchema,
    typeof SharedDocumentPrimaryKey
  >;
  let scopeA: ScopedTabularStorage<any, any>;
  let scopeB: ScopedTabularStorage<any, any>;

  beforeEach(async () => {
    sharedStorage = new InMemoryTabularStorage(
      SharedDocumentStorageSchema,
      SharedDocumentPrimaryKey,
      SharedDocumentIndexes
    );
    await sharedStorage.setupDatabase();
    scopeA = new ScopedTabularStorage(sharedStorage, "kb-a");
    scopeB = new ScopedTabularStorage(sharedStorage, "kb-b");
  });

  afterEach(() => {
    sharedStorage.destroy();
  });

  describe("CRUD isolation", () => {
    test("put via scope-A is invisible to scope-B", async () => {
      const entity = await scopeA.put({ doc_id: "d1", data: '{"text":"hello"}' });
      expect(entity).toBeDefined();
      expect(entity.doc_id).toBe("d1");
      expect((entity as any).kb_id).toBeUndefined();

      const fromA = await scopeA.get({ doc_id: "d1" });
      expect(fromA).toBeDefined();
      expect(fromA!.doc_id).toBe("d1");

      const fromB = await scopeB.get({ doc_id: "d1" });
      expect(fromB).toBeUndefined();
    });

    test("getAll returns only own scope's records", async () => {
      await scopeA.put({ doc_id: "a1", data: "a" });
      await scopeA.put({ doc_id: "a2", data: "a" });
      await scopeB.put({ doc_id: "b1", data: "b" });

      const allA = await scopeA.getAll();
      const allB = await scopeB.getAll();
      expect(allA).toHaveLength(2);
      expect(allB).toHaveLength(1);
      expect(allA!.every((e: any) => e.kb_id === undefined)).toBe(true);
    });

    test("query filters by kb_id", async () => {
      await scopeA.put({ doc_id: "q1", data: "shared-data" });
      await scopeB.put({ doc_id: "q2", data: "shared-data" });

      const resultsA = await scopeA.query({ data: "shared-data" } as any);
      expect(resultsA).toHaveLength(1);
      expect(resultsA![0].doc_id).toBe("q1");
    });

    test("size returns count for only this scope", async () => {
      await scopeA.put({ doc_id: "s1", data: "a" });
      await scopeA.put({ doc_id: "s2", data: "a" });
      await scopeB.put({ doc_id: "s3", data: "b" });

      expect(await scopeA.size()).toBe(2);
      expect(await scopeB.size()).toBe(1);
    });

    test("returned entities do not include kb_id", async () => {
      const entity = await scopeA.put({ doc_id: "strip1", data: "x" });
      expect("kb_id" in entity).toBe(false);

      const got = await scopeA.get({ doc_id: "strip1" });
      expect("kb_id" in got!).toBe(false);

      const queried = await scopeA.query({ doc_id: "strip1" } as any);
      expect("kb_id" in queried![0]).toBe(false);
    });
  });

  describe("constructor contract", () => {
    test("throws when inner PK omits kb_id (single-column PK)", () => {
      const SchemaNoKbInPk = {
        type: "object",
        properties: {
          doc_id: { type: "string" },
          kb_id: { type: "string" },
          data: { type: "string" },
        },
        required: ["doc_id"],
        additionalProperties: true,
      } as const;
      const inner = new InMemoryTabularStorage(SchemaNoKbInPk as any, ["doc_id"] as any, []);
      expect(() => new ScopedTabularStorage(inner, "kb-x")).toThrow(/kb_id/);
    });

    test("accepts inner PK that includes kb_id (shared-table schemas)", () => {
      // Implicit in beforeEach scopeA/scopeB, but assert directly.
      expect(() => new ScopedTabularStorage(sharedStorage, "kb-x")).not.toThrow();
    });

    test("warns when inner storage does not expose primaryKeyNames", () => {
      // Custom storage stub that doesn't extend BaseTabularStorage and
      // therefore has no `primaryKeyNames` field. The constructor should
      // log a warning but NOT throw.
      // The constructor warns through `getLogger()`, whose default is a
      // `NullLogger` unless the environment asks for one that writes — Vitest's
      // Vite pipeline does (`import.meta.env.DEV`), Bun's runner does not. Install
      // the logger the assertion needs rather than inheriting one.
      const previousLogger: ILogger = getLogger();
      setLogger(new ConsoleLogger({ level: "warn" }));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const customInner = {
          // Minimal stub — we never actually call any methods in this test.
        } as any;
        expect(() => new ScopedTabularStorage(customInner, "kb-x")).not.toThrow();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/primaryKeyNames is not exposed/);
      } finally {
        warnSpy.mockRestore();
        setLogger(previousLogger);
      }
    });
  });

  describe("getBulk isolation", () => {
    test("getBulk returns only own scope's rows when keys collide across scopes", async () => {
      await scopeA.put({ doc_id: "x", data: "from-A" });
      await scopeA.put({ doc_id: "y", data: "from-A" });
      await scopeB.put({ doc_id: "x", data: "from-B" });
      await scopeB.put({ doc_id: "z", data: "from-B" });

      const fromA = await scopeA.getBulk([
        { doc_id: "x" },
        { doc_id: "y" },
        { doc_id: "z" },
      ] as any);
      expect(fromA).toHaveLength(2);
      const aMap = new Map(fromA.map((r: any) => [r.doc_id, r.data]));
      expect(aMap.get("x")).toBe("from-A");
      expect(aMap.get("y")).toBe("from-A");
      expect(aMap.has("z")).toBe(false);
      expect(fromA.every((r: any) => r.kb_id === undefined)).toBe(true);

      const fromB = await scopeB.getBulk([{ doc_id: "x" }, { doc_id: "z" }] as any);
      expect(fromB).toHaveLength(2);
      const bMap = new Map(fromB.map((r: any) => [r.doc_id, r.data]));
      expect(bMap.get("x")).toBe("from-B");
      expect(bMap.get("z")).toBe("from-B");
    });

    test("getBulk emits event with unscoped keys", async () => {
      await scopeA.put({ doc_id: "e1", data: "a" });
      await scopeB.put({ doc_id: "e1", data: "b" });

      const fn = vi.fn();
      scopeA.on("getBulk", fn);
      const result = await scopeA.getBulk([{ doc_id: "e1" }, { doc_id: "missing" }] as any);

      expect(fn).toHaveBeenCalledTimes(1);
      const [emittedKeys, emittedRows] = fn.mock.calls[0];
      expect(emittedKeys).toEqual([{ doc_id: "e1" }, { doc_id: "missing" }]);
      expect(emittedRows).toEqual(result);
      expect(emittedRows.every((r: any) => r.kb_id === undefined)).toBe(true);
    });

    test("delegates to inner.getBulk in one round trip (IN-tuple WHERE optimization)", async () => {
      // Contract: ScopedTabularStorage's constructor enforces kb_id is in PK,
      // so getBulk can safely delegate to the inner's batched IN-tuple form
      // rather than fanning out per-key. This test asserts that delegation
      // happens — a regression to per-key fan-out would slow shared-table
      // production deployments noticeably.
      await scopeA.put({ doc_id: "fast1", data: "a" });
      await scopeA.put({ doc_id: "fast2", data: "a" });

      // Note: we assert `inner.getBulk` is called exactly once with all keys.
      // We intentionally do NOT assert `inner.get` was not called — the
      // `BaseTabularStorage.getBulk` default implementation fans out to
      // `this.get` internally for backends without a batched override (e.g.
      // InMemory). The contract we lock in here is: the scoped wrapper
      // makes ONE `inner.getBulk(scopedKeys)` call rather than N
      // `inner.get(...)` calls of its own — which is what unlocks the
      // IN-tuple WHERE optimization on SQL backends that DO override
      // `getBulk`. A regression to per-key fan-out from the wrapper would
      // show as N calls here, not 1.
      const spy = vi.spyOn(sharedStorage, "getBulk");
      const result = await scopeA.getBulk([{ doc_id: "fast1" }, { doc_id: "fast2" }] as any);

      expect(spy).toHaveBeenCalledTimes(1);
      const [calledKeys] = spy.mock.calls[0];
      expect(calledKeys).toEqual([
        { doc_id: "fast1", kb_id: "kb-a" },
        { doc_id: "fast2", kb_id: "kb-a" },
      ]);
      expect(result).toHaveLength(2);
      expect(result.every((r: any) => r.kb_id === undefined)).toBe(true);
      spy.mockRestore();
    });
  });

  describe("key collision prevention", () => {
    test("identical doc_id across scopes do not collide", async () => {
      await scopeA.put({ doc_id: "same-id", data: "scope-A data" });
      await scopeB.put({ doc_id: "same-id", data: "scope-B data" });

      const fromA = await scopeA.get({ doc_id: "same-id" });
      const fromB = await scopeB.get({ doc_id: "same-id" });

      expect(fromA).toBeDefined();
      expect(fromB).toBeDefined();
      expect((fromA as any).data).toBe("scope-A data");
      expect((fromB as any).data).toBe("scope-B data");

      expect(await scopeA.size()).toBe(1);
      expect(await scopeB.size()).toBe(1);
    });
  });

  describe("putBulk", () => {
    test("bulk inserts are scoped correctly", async () => {
      const entities = await scopeA.putBulk([
        { doc_id: "b1", data: "a" },
        { doc_id: "b2", data: "a" },
      ]);
      expect(entities).toHaveLength(2);
      expect(entities.every((e: any) => e.kb_id === undefined)).toBe(true);

      expect(await scopeA.size()).toBe(2);
      expect(await scopeB.size()).toBe(0);
    });
  });

  describe("delete isolation", () => {
    test("delete via scope-B cannot remove scope-A's record", async () => {
      await scopeA.put({ doc_id: "del1", data: "a" });
      await scopeB.delete({ doc_id: "del1" });

      const fromA = await scopeA.get({ doc_id: "del1" });
      expect(fromA).toBeDefined();
    });

    test("delete via own scope removes the record", async () => {
      await scopeA.put({ doc_id: "del2", data: "a" });
      await scopeA.delete({ doc_id: "del2" });

      const fromA = await scopeA.get({ doc_id: "del2" });
      expect(fromA).toBeUndefined();
    });

    test("deleteAll does not affect other scope", async () => {
      await scopeA.put({ doc_id: "da1", data: "a" });
      await scopeA.put({ doc_id: "da2", data: "a" });
      await scopeB.put({ doc_id: "db1", data: "b" });

      await scopeA.deleteAll();

      expect(await scopeA.size()).toBe(0);
      expect(await scopeB.size()).toBe(1);
    });

    test("deleteSearch is scoped", async () => {
      await scopeA.put({ doc_id: "ds1", data: "target" });
      await scopeB.put({ doc_id: "ds2", data: "target" });

      await scopeA.deleteSearch({ data: "target" } as any);

      expect(await scopeA.size()).toBe(0);
      expect(await scopeB.size()).toBe(1);
    });
  });

  describe("event isolation", () => {
    test("on('put') only fires for own scope", async () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      scopeA.on("put", listenerA);
      scopeB.on("put", listenerB);

      await scopeA.put({ doc_id: "ev1", data: "a" });

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).not.toHaveBeenCalled();

      await scopeB.put({ doc_id: "ev2", data: "b" });

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
    });

    test("on('clearall') only fires for own scope", async () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      scopeA.on("clearall", listenerA);
      scopeB.on("clearall", listenerB);

      await scopeA.deleteAll();

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).not.toHaveBeenCalled();
    });

    test("off removes the listener", async () => {
      const listener = vi.fn();
      scopeA.on("put", listener);
      scopeA.off("put", listener);

      await scopeA.put({ doc_id: "off1", data: "a" });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("records and pages generators", () => {
    test("records() yields only scoped records", async () => {
      await scopeA.put({ doc_id: "r1", data: "a" });
      await scopeA.put({ doc_id: "r2", data: "a" });
      await scopeB.put({ doc_id: "r3", data: "b" });

      const collected = [];
      for await (const record of scopeA.records(10)) {
        collected.push(record);
      }
      expect(collected).toHaveLength(2);
      expect(collected.every((e: any) => e.kb_id === undefined)).toBe(true);
    });

    test("pages() yields only scoped records", async () => {
      await scopeA.put({ doc_id: "p1", data: "a" });
      await scopeA.put({ doc_id: "p2", data: "a" });
      await scopeA.put({ doc_id: "p3", data: "a" });
      await scopeB.put({ doc_id: "p4", data: "b" });

      const pages = [];
      for await (const page of scopeA.pages(2)) {
        pages.push(page);
      }
      const total = pages.reduce((sum, p) => sum + p.length, 0);
      expect(total).toBe(3);
    });

    test("rejects a cursor minted by a different KB scope", async () => {
      // Cross-KB cursor reuse silently produced wrong pages before this
      // guard: the inner store's cursor encodes kb_id as part of the
      // effective ordering, but two ScopedTabularStorages over the same
      // shared table accept structurally-identical cursors. With the
      // [kb_id ASC, doc_id ASC] effective ordering, KB-A's cursor parked
      // at (A, "d1") forwarded to KB-B would page from the wrong slot.
      await scopeA.put({ doc_id: "d1", data: '{"text":"a1"}' });
      await scopeA.put({ doc_id: "d2", data: '{"text":"a2"}' });
      await scopeB.put({ doc_id: "d1", data: '{"text":"b1"}' });
      await scopeB.put({ doc_id: "d2", data: '{"text":"b2"}' });

      const aPage = await scopeA.getPage({ limit: 1 });
      expect(aPage.items.length).toBe(1);
      expect(aPage.nextCursor).toBeDefined();

      // Hand A's cursor to B. The fix decodes the cursor, sees kb_id="kb-a",
      // compares to this.kbId="kb-b", throws.
      await expect(scopeB.getPage({ limit: 1, cursor: aPage.nextCursor })).rejects.toThrow(/kb_id/);
    });
  });
});

describe("ScopedVectorStorage", () => {
  let sharedStorage: InMemoryVectorStorage<
    typeof SharedChunkVectorStorageSchema,
    typeof SharedChunkPrimaryKey
  >;
  let scopeA: ScopedVectorStorage<any, any>;
  let scopeB: ScopedVectorStorage<any, any>;

  beforeEach(async () => {
    sharedStorage = new InMemoryVectorStorage(
      SharedChunkVectorStorageSchema,
      SharedChunkPrimaryKey,
      SharedChunkIndexes,
      3
    );
    await sharedStorage.setupDatabase();
    scopeA = new ScopedVectorStorage(sharedStorage, "kb-a");
    scopeB = new ScopedVectorStorage(sharedStorage, "kb-b");
  });

  afterEach(() => {
    sharedStorage?.destroy?.();
  });

  test("getVectorDimensions delegates to inner", () => {
    expect(scopeA.getVectorDimensions()).toBe(3);
  });

  test("similaritySearch returns only own scope's results", async () => {
    const vecA = new Float32Array([1, 0, 0]);
    const vecB = new Float32Array([0, 1, 0]);

    await scopeA.put({
      chunk_id: "ca1",
      doc_id: "doc-a",
      vector: vecA,
      metadata: { text: "scope A chunk" },
    });
    await scopeB.put({
      chunk_id: "cb1",
      doc_id: "doc-b",
      vector: vecB,
      metadata: { text: "scope B chunk" },
    });

    const query = new Float32Array([1, 0, 0]);
    const results = await scopeA.similaritySearch(query, { topK: 10 });

    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe("ca1");
    expect((results[0] as any).kb_id).toBeUndefined();
    expect(results[0].score).toBeDefined();
  });

  test("CRUD isolation works for vector storage", async () => {
    await scopeA.put({
      chunk_id: "iso1",
      doc_id: "doc-a",
      vector: new Float32Array([1, 0, 0]),
      metadata: {},
    });

    expect(await scopeA.get({ chunk_id: "iso1" })).toBeDefined();
    expect(await scopeB.get({ chunk_id: "iso1" })).toBeUndefined();

    await scopeB.delete({ chunk_id: "iso1" });
    expect(await scopeA.get({ chunk_id: "iso1" })).toBeDefined();

    await scopeA.delete({ chunk_id: "iso1" });
    expect(await scopeA.get({ chunk_id: "iso1" })).toBeUndefined();
  });
});

describe("registerKnowledgeBase with sharedTables", () => {
  test("persisted record uses shared table names", async () => {
    const kb = await createKnowledgeBase({
      name: `shared-reg-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });

    const id = `shared-${uuid4()}`;
    await registerKnowledgeBase(id, kb, { sharedTables: true });

    const repo = getGlobalKnowledgeBaseRepository();
    const record = await repo.getKnowledgeBase(id);
    expect(record).toBeDefined();
    expect(record!.document_table).toBe("shared_documents");
    expect(record!.chunk_table).toBe("shared_chunks");
    expect(isSharedTableMode(record!)).toBe(true);

    kb.destroy();
  });

  test("default registration uses per-KB table names", async () => {
    const kb = await createKnowledgeBase({
      name: `default-reg-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });

    const id = `default-${uuid4()}`;
    await registerKnowledgeBase(id, kb);

    const repo = getGlobalKnowledgeBaseRepository();
    const record = await repo.getKnowledgeBase(id);
    expect(record).toBeDefined();
    expect(isSharedTableMode(record!)).toBe(false);

    kb.destroy();
  });
});

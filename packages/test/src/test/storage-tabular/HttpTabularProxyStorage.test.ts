/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { HttpTabularProxyStorage, InMemoryTabularStorage } from "@workglow/storage";
import { describe, expect, it } from "vitest";

const TestSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    value: { type: "number" },
  },
  required: ["id", "name", "value"],
  additionalProperties: false,
} as const;
const TestPrimaryKey = ["id"] as const;

function makeFakeServer<Schema extends typeof TestSchema, PK extends typeof TestPrimaryKey>(
  storage: InMemoryTabularStorage<Schema, PK>
): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path: string, init?: RequestInit) => {
    const match = /^\/api\/storage\/([^/]+)\/([^/]+)$/.exec(path);
    if (!match) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    const op = match[2];
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    try {
      switch (op) {
        case "put": {
          const entity = await storage.put(body.value);
          return new Response(JSON.stringify({ entity }), { status: 200 });
        }
        case "get": {
          const entity = await storage.get(body.key);
          return new Response(JSON.stringify({ entity: entity ?? null }), { status: 200 });
        }
        case "delete": {
          await storage.delete(body.key);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        case "getBulk": {
          const entities = await storage.getBulk(body.keys);
          return new Response(JSON.stringify({ entities }), { status: 200 });
        }
        case "putBulk": {
          const entities = await storage.putBulk(body.values);
          return new Response(JSON.stringify({ entities }), { status: 200 });
        }
        case "query": {
          const entities = await storage.query(body.criteria, body.options);
          return new Response(JSON.stringify({ entities: entities ?? null }), { status: 200 });
        }
        case "getAll": {
          const entities = await storage.getAll(body.options);
          return new Response(JSON.stringify({ entities: entities ?? null }), { status: 200 });
        }
        case "count": {
          const count = await storage.count(body.criteria);
          return new Response(JSON.stringify({ count }), { status: 200 });
        }
        case "size": {
          const size = await storage.size();
          return new Response(JSON.stringify({ size }), { status: 200 });
        }
        case "deleteAll": {
          await storage.deleteAll();
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        case "deleteSearch": {
          await storage.deleteSearch(body.criteria);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        default:
          return new Response(JSON.stringify({ error: `unknown op ${op}` }), { status: 404 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
  };
}

describe("HttpTabularProxyStorage — put/get/delete", () => {
  it("put forwards the value and returns the server entity", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });

    const result = await proxy.put({ id: "a", name: "alpha", value: 1 });
    expect(result).toEqual({ id: "a", name: "alpha", value: 1 });
    expect(await backing.get({ id: "a" })).toEqual({ id: "a", name: "alpha", value: 1 });
  });

  it("get returns undefined when the server returns null", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    const result = await proxy.get({ id: "missing" } as never);
    expect(result).toBeUndefined();
  });

  it("get returns the stored entity", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "x", name: "ex", value: 42 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    expect(await proxy.get({ id: "x" } as never)).toEqual({ id: "x", name: "ex", value: 42 });
  });

  it("delete removes the entity from the backing store", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "del", name: "d", value: 0 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    await proxy.delete({ id: "del" } as never);
    expect(await backing.get({ id: "del" })).toBeUndefined();
  });

  it("propagates server error body as a thrown Error", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: fetchImpl,
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    await expect(proxy.put({ id: "a", name: "x", value: 1 })).rejects.toThrow(/boom/);
  });
});

describe("HttpTabularProxyStorage — bulk", () => {
  it("putBulk preserves input order", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    const result = await proxy.putBulk([
      { id: "a", name: "A", value: 1 },
      { id: "b", name: "B", value: 2 },
    ]);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("getBulk returns only found entities", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "A", value: 1 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    const result = await proxy.getBulk([{ id: "a" }, { id: "missing" }] as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "a" });
  });

  it("getBulk with empty keys returns empty array without calling the server", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response(JSON.stringify({ entities: [] }), { status: 200 });
    };
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: fetchImpl,
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    expect(await proxy.getBulk([])).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("HttpTabularProxyStorage — query/getAll", () => {
  it("query forwards criteria + options", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "alpha", value: 1 });
    await backing.put({ id: "b", name: "alpha", value: 2 });
    await backing.put({ id: "c", name: "beta", value: 3 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    const result = await proxy.query({ name: "alpha" });
    expect(result).toHaveLength(2);
    expect(result?.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("getAll returns all rows", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "A", value: 1 });
    await backing.put({ id: "b", name: "B", value: 2 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    const result = await proxy.getAll();
    expect(result).toHaveLength(2);
  });

  it("query/getAll return undefined when the server sends entities: null", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ entities: null }), { status: 200 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: fetchImpl,
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    expect(await proxy.query({ name: "x" })).toBeUndefined();
    expect(await proxy.getAll()).toBeUndefined();
  });
});

describe("HttpTabularProxyStorage — count/size/delete bulk", () => {
  it("size returns row count", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "A", value: 1 });
    await backing.put({ id: "b", name: "B", value: 2 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    expect(await proxy.size()).toBe(2);
  });

  it("count with criteria filters", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "x", value: 1 });
    await backing.put({ id: "b", name: "y", value: 2 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    expect(await proxy.count({ name: "x" })).toBe(1);
  });

  it("deleteAll empties the table", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "A", value: 1 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    await proxy.deleteAll();
    expect(await backing.size()).toBe(0);
  });

  it("deleteSearch removes matching rows", async () => {
    const backing = new InMemoryTabularStorage<typeof TestSchema, typeof TestPrimaryKey>(
      TestSchema,
      TestPrimaryKey
    );
    await backing.put({ id: "a", name: "x", value: 1 });
    await backing.put({ id: "b", name: "y", value: 2 });
    const proxy = new HttpTabularProxyStorage<typeof TestSchema, typeof TestPrimaryKey>({
      fetch: makeFakeServer(backing),
      table: "things",
      schema: TestSchema,
      primaryKey: TestPrimaryKey,
    });
    await proxy.deleteSearch({ name: "x" });
    expect(await backing.size()).toBe(1);
    expect(await backing.get({ id: "b" })).toBeDefined();
  });
});

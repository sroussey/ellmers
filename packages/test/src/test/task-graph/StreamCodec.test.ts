/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-mode stream codecs: round-trip a port's delta events through an ordered
 * byte stream (the persisted form a streaming cache backing stores) and fold
 * the bytes back into the materialized port value.
 *
 *  - append : UTF-8 text blob; decode re-emits text-deltas; materialize concats.
 *  - object : NDJSON delta log (one object-delta per line); decode re-emits the
 *             deltas; materialize folds them (array upsert-by-id / non-array
 *             replace, matching the live accumulator).
 *  - binary : identity bytes; decode re-emits binary-deltas; materialize -> Blob.
 */

import type { StreamEvent } from "@workglow/task-graph";
import { getStreamPortCodec } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

async function concatBytes(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks = await collect(it);
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return merged;
}

describe("stream port codecs", () => {
  describe("append", () => {
    const codec = getStreamPortCodec("append");
    const events: StreamEvent[] = [
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "text-delta", port: "text", textDelta: " world" },
    ];

    it("encodes text-deltas to a UTF-8 blob and materializes the concatenation", async () => {
      const bytes = await concatBytes(codec.encode(fromArray(events), "text"));
      expect(new TextDecoder().decode(bytes)).toBe("Hello world");
      const value = await codec.materialize(fromArray([bytes]), "text");
      expect(value).toBe("Hello world");
    });

    it("decode re-emits text-deltas that accumulate to the same string", async () => {
      const bytes = await concatBytes(codec.encode(fromArray(events), "text"));
      const decoded = await collect(codec.decode(fromArray([bytes]), "text"));
      expect(decoded.every((e) => e.type === "text-delta")).toBe(true);
      const joined = decoded.map((e) => (e as any).textDelta).join("");
      expect(joined).toBe("Hello world");
    });

    it("ignores deltas for other ports", async () => {
      const mixed: StreamEvent[] = [
        { type: "text-delta", port: "text", textDelta: "keep" },
        { type: "text-delta", port: "other", textDelta: "drop" },
      ];
      const bytes = await concatBytes(codec.encode(fromArray(mixed), "text"));
      expect(new TextDecoder().decode(bytes)).toBe("keep");
    });
  });

  describe("object", () => {
    const codec = getStreamPortCodec("object");

    it("array deltas upsert by id on materialize", async () => {
      const events: StreamEvent[] = [
        { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] },
        { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "b" }] },
        { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "c" }] },
      ];
      const bytes = await concatBytes(codec.encode(fromArray(events), "items"));
      // NDJSON: one line per delta.
      expect(new TextDecoder().decode(bytes).trim().split("\n")).toHaveLength(3);
      const value = await codec.materialize(fromArray([bytes]), "items");
      expect(value).toEqual([
        { id: 1, v: "b" },
        { id: 2, v: "c" },
      ]);
    });

    it("non-array deltas replace on materialize", async () => {
      const events: StreamEvent[] = [
        { type: "object-delta", port: "obj", objectDelta: { a: 1 } },
        { type: "object-delta", port: "obj", objectDelta: { a: 1, b: 2 } },
      ];
      const bytes = await concatBytes(codec.encode(fromArray(events), "obj"));
      const value = await codec.materialize(fromArray([bytes]), "obj");
      expect(value).toEqual({ a: 1, b: 2 });
    });

    it("decode re-emits the original object-deltas", async () => {
      const events: StreamEvent[] = [
        { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] },
        { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "c" }] },
      ];
      const bytes = await concatBytes(codec.encode(fromArray(events), "items"));
      const decoded = await collect(codec.decode(fromArray([bytes]), "items"));
      expect(decoded).toEqual(events);
    });
  });

  describe("binary", () => {
    const codec = getStreamPortCodec("binary");

    it("is byte-identity and materializes to a Blob", async () => {
      const events: StreamEvent[] = [
        { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([1, 2]) },
        { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([3]) },
      ];
      const bytes = await concatBytes(codec.encode(fromArray(events), "file"));
      expect(Array.from(bytes)).toEqual([1, 2, 3]);
      const value = (await codec.materialize(fromArray([bytes]), "file")) as Blob;
      expect(Array.from(new Uint8Array(await value.arrayBuffer()))).toEqual([1, 2, 3]);
    });
  });

  it("rejects non-streamable modes", () => {
    expect(() => getStreamPortCodec("replace")).toThrow();
  });
});

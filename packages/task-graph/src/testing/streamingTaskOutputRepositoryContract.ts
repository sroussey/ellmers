/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Package specifier, not relative: this ships from `./test`, a separate
// `--packages=external` bundle. A relative import would inline a second copy of
// the codec registry, so a ref encoded by the code under test would be read back
// through a different registry instance.
import type { CacheRef, StreamEvent } from "@workglow/task-graph";
import {
  getStreamPortCodec,
  isCacheRef,
  makeCacheRef,
  streamRefViaBacking,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

/**
 * A repository under test. Kept structural rather than importing the concrete
 * `TaskOutputRepository` type, because the streaming surface is what this
 * contract is about and adapters differ in what else they carry.
 */
export interface StreamingRepositoryUnderTest {
  supportsStreaming(): boolean;
  isDurable(): boolean;
  getOutputByRef(ref: CacheRef): Promise<Blob | undefined>;
  getOutputStreamByRef(ref: CacheRef): Promise<AsyncIterable<Uint8Array> | undefined>;
  saveOutputStreamPort(
    taskType: string,
    inputs: object,
    port: string,
    mode: string,
    stream: AsyncIterable<Uint8Array>,
    meta: object
  ): Promise<CacheRef>;
  clear(): Promise<void>;
  clearOlderThan(ms: number): Promise<void>;
  setupDatabase?(): Promise<void>;
}

export interface StreamingTaskOutputRepositoryContractOptions {
  /** Suite name, normally the adapter's class name. */
  readonly name: string;
  /** Fresh repository over a fresh table, already `setupDatabase()`-ed. */
  readonly makeRepo: () => Promise<{
    repo: StreamingRepositoryUnderTest;
    table: string;
  }>;
  /**
   * A second repository over the SAME backing store and table, used to prove a
   * ref written by one instance resolves from another. Adapters differ in what
   * they are handed (a database handle, a client), so they build it themselves.
   */
  readonly makeSibling: (table: string) => Promise<StreamingRepositoryUnderTest>;
  /** This backend's cache-ref URI scheme, e.g. `sqliteblob`. */
  readonly refScheme: string;
  /** Another backend's scheme, to prove foreign refs are declined rather than misread. */
  readonly foreignRefScheme: string;
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}
async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}
async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

/**
 * Conformance suite for a streaming task-output repository: JSON rows plus port
 * payloads stored as ordered blob chunks, addressed by cache ref.
 *
 * Extracted from three per-backend suites whose bodies were ~95% identical —
 * they differed only in the ref scheme, a foreign scheme, and how a sibling
 * instance is constructed. Those are the options above; everything else is
 * shared, so a behavioural fix lands for every backend at once.
 */
export function runStreamingTaskOutputRepositoryContract(
  opts: StreamingTaskOutputRepositoryContractOptions
): void {
  const { name, makeRepo, makeSibling, refScheme, foreignRefScheme } = opts;

  describe(name, () => {
    it("advertises the streaming surface and is durable", async () => {
      const { repo } = await makeRepo();
      expect(repo.supportsStreaming()).toBe(true);
      expect(typeof repo.getOutputStreamByRef).toBe("function");
      expect(repo.isDurable()).toBe(true);
    });

    it("round-trips an append (text) port through a ref", async () => {
      const { repo } = await makeRepo();
      const codec = getStreamPortCodec("append");
      const events: StreamEvent[] = [
        { type: "text-delta", port: "text", textDelta: "Bonjour" },
        { type: "text-delta", port: "text", textDelta: " monde" },
      ];
      const ref = await repo.saveOutputStreamPort(
        "T",
        { p: 1 },
        "text",
        "append",
        codec.encode(fromArray(events), "text"),
        {}
      );
      expect(isCacheRef(ref)).toBe(true);
      expect(ref.port).toBe("text");
      expect(ref.mode).toBe("append");
      expect(ref.size).toBeGreaterThan(0);
      expect(await codec.materialize((await repo.getOutputStreamByRef(ref))!, "text")).toBe(
        "Bonjour monde"
      );
    });

    it("round-trips an object (NDJSON) port through a ref", async () => {
      const { repo } = await makeRepo();
      const codec = getStreamPortCodec("object");
      const events: StreamEvent[] = [
        { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "a" }] },
        { type: "object-delta", port: "items", objectDelta: [{ id: 1, v: "b" }] },
        { type: "object-delta", port: "items", objectDelta: [{ id: 2, v: "c" }] },
      ];
      const ref = await repo.saveOutputStreamPort(
        "T",
        { p: 1 },
        "items",
        "object",
        codec.encode(fromArray(events), "items"),
        {}
      );
      expect(ref.mode).toBe("object");
      expect(await codec.materialize((await repo.getOutputStreamByRef(ref))!, "items")).toEqual([
        { id: 1, v: "b" },
        { id: 2, v: "c" },
      ]);
    });

    it("round-trips a binary port through a ref and via getOutputByRef", async () => {
      const { repo } = await makeRepo();
      const codec = getStreamPortCodec("binary");
      const events: StreamEvent[] = [
        { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([10, 20]) },
        { type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([30]) },
      ];
      const ref = await repo.saveOutputStreamPort(
        "T",
        { p: 1 },
        "file",
        "binary",
        codec.encode(fromArray(events), "file"),
        {}
      );
      const blob = await repo.getOutputByRef(ref);
      expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([10, 20, 30]);
      expect(await collect((await repo.getOutputStreamByRef(ref))!)).toEqual([10, 20, 30]);
    });

    it("round-trips a multi-chunk write and reports size", async () => {
      const { repo } = await makeRepo();
      const ref = await repo.saveOutputStreamPort(
        "T",
        { k: 1 },
        "file",
        "binary",
        gen(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])),
        { mime: "application/octet-stream" }
      );
      expect(ref.size).toBe(6);
      expect(ref.mime).toBe("application/octet-stream");
      expect(await collect((await repo.getOutputStreamByRef(ref))!)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("keeps distinct ports of the same (taskType, inputs) at distinct refs", async () => {
      const { repo } = await makeRepo();
      const text = getStreamPortCodec("append");
      const bin = getStreamPortCodec("binary");
      const a = await repo.saveOutputStreamPort(
        "T",
        { p: 9 },
        "text",
        "append",
        text.encode(fromArray([{ type: "text-delta", port: "text", textDelta: "x" }]), "text"),
        {}
      );
      const b = await repo.saveOutputStreamPort(
        "T",
        { p: 9 },
        "file",
        "binary",
        bin.encode(
          fromArray([{ type: "binary-delta", port: "file", binaryDelta: Uint8Array.from([1]) }]),
          "file"
        ),
        {}
      );
      expect(a.$ref).not.toBe(b.$ref);
      expect(await text.materialize((await repo.getOutputStreamByRef(a))!, "text")).toBe("x");
      const blob = await repo.getOutputByRef(b);
      expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1]);
    });

    it("returns undefined from both readers for unknown / foreign refs", async () => {
      const { repo } = await makeRepo();
      const unknown = makeCacheRef({ $ref: `${refScheme}://never-written` });
      const foreign = makeCacheRef({ $ref: `${foreignRefScheme}://x` });
      expect(await repo.getOutputByRef(unknown)).toBeUndefined();
      expect(await repo.getOutputStreamByRef(unknown)).toBeUndefined();
      expect(await repo.getOutputByRef(foreign)).toBeUndefined();
      expect(await repo.getOutputStreamByRef(foreign)).toBeUndefined();
    });

    it("clear() makes previously written refs dangle (a miss, not empty)", async () => {
      const { repo } = await makeRepo();
      const ref = await repo.saveOutputStreamPort(
        "T",
        { k: 4 },
        "file",
        "binary",
        gen(new Uint8Array([1])),
        {}
      );
      await repo.clear();
      expect(await repo.getOutputByRef(ref)).toBeUndefined();
      expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
      expect(await streamRefViaBacking(ref, repo as never)).toBeUndefined();
    });

    it("clearOlderThan prunes blob payloads alongside rows", async () => {
      const { repo } = await makeRepo();
      const ref = await repo.saveOutputStreamPort(
        "T",
        { k: 5 },
        "file",
        "binary",
        gen(new Uint8Array([1])),
        {}
      );
      // Negative cutoff => a future instant, so everything counts as older.
      await repo.clearOlderThan(-60_000);
      expect(await repo.getOutputStreamByRef(ref)).toBeUndefined();
    });

    it("a sibling instance over the same backing store resolves the ref", async () => {
      const { repo, table } = await makeRepo();
      const ref = await repo.saveOutputStreamPort(
        "T",
        { k: 6 },
        "file",
        "binary",
        gen(new Uint8Array([4, 2])),
        {}
      );
      const sibling = await makeSibling(table);
      expect(await collect((await sibling.getOutputStreamByRef(ref))!)).toEqual([4, 2]);
      const blob = await sibling.getOutputByRef(ref);
      expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([4, 2]);
    });
  });
}

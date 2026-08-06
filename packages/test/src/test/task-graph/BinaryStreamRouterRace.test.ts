/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BinaryStreamRouter, makeCacheRef, type BinaryRefSink } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

const ref = makeCacheRef({ $ref: "inmem://race" });

async function drain(iter: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe("BinaryStreamRouter push/end race", () => {
  it("discards a chunk pushed after end() and does not deliver it to the sink", async () => {
    let received: Uint8Array[] = [];
    const sink: BinaryRefSink = async (iter) => {
      received = await drain(iter);
      return ref;
    };
    const router = new BinaryStreamRouter(sink, 1 << 20);

    await router.push(new Uint8Array([1, 2]));
    router.end();
    // Push AFTER end must not surface to the sink.
    await router.push(new Uint8Array([3, 4]));

    await router.ref();
    expect(received.map((c) => Array.from(c))).toEqual([[1, 2]]);
  });

  it("survives 100 microtask-interleaved race attempts without leaking a post-end chunk", async () => {
    for (let i = 0; i < 100; i++) {
      let received: Uint8Array[] = [];
      const sink: BinaryRefSink = async (iter) => {
        received = await drain(iter);
        return ref;
      };
      const router = new BinaryStreamRouter(sink, 1 << 20);

      // Interleave a push and an end via microtasks: the end may land between
      // the push's fast-path closed-check and its buffer append.
      const pushP = Promise.resolve().then(() => router.push(new Uint8Array([9])));
      const endP = Promise.resolve().then(() => router.end());
      await Promise.all([pushP, endP]);
      await router.ref();

      // The push either lands before end (delivered) or after (discarded);
      // never yield anything beyond that single chunk.
      expect(received.length).toBeLessThanOrEqual(1);
      if (received.length === 1) {
        expect(Array.from(received[0]!)).toEqual([9]);
      }
    }
  });

  it("surfaces fail() to the sink even when a chunk was already buffered", async () => {
    let sinkErr: unknown;
    const sink: BinaryRefSink = async (iter) => {
      try {
        for await (const _ of iter) {
          // Yield a microtask so fail() can land between chunks.
          await Promise.resolve();
        }
      } catch (e) {
        sinkErr = e;
      }
      return ref;
    };
    const router = new BinaryStreamRouter(sink, 1 << 20);

    await router.push(new Uint8Array([1]));
    await router.push(new Uint8Array([2]));
    const bomb = new Error("stream failed");
    router.fail(bomb);

    await router.ref();
    expect(sinkErr).toBe(bomb);
  });

  it("is idempotent under double end() — no extra chunks or errors surface", async () => {
    let received: Uint8Array[] = [];
    const sink: BinaryRefSink = async (iter) => {
      received = await drain(iter);
      return ref;
    };
    const router = new BinaryStreamRouter(sink, 1 << 20);

    await router.push(new Uint8Array([42]));
    router.end();
    router.end();
    router.end();

    await router.ref();
    expect(received.map((c) => Array.from(c))).toEqual([[42]]);
  });
});

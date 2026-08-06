/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The streaming read helper `streamRefViaBacking` must support backings whose
 * `getOutputStreamByRef` is asynchronous (DB stores that cannot probe existence
 * synchronously), while leaving the synchronous FsFolder/in-memory path
 * byte-identical.
 */

import type { CacheRef } from "@workglow/task-graph";
import { makeCacheRef, streamRefViaBacking } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

async function* gen(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}
async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

describe("streamRefViaBacking with async getOutputStreamByRef", () => {
  it("awaits a Promise-returning stream reader (async backing)", async () => {
    const backing = {
      getOutputStreamByRef: (_ref: CacheRef) =>
        Promise.resolve(gen(new Uint8Array([1, 2]), new Uint8Array([3]))),
    };
    const stream = await streamRefViaBacking(makeCacheRef({ $ref: "x://a" }), backing);
    expect(stream).toBeDefined();
    expect(await collect(stream!)).toEqual([1, 2, 3]);
  });

  it("treats an async undefined as a miss and falls back to getOutputByRef", async () => {
    let blobRead = false;
    const backing = {
      getOutputStreamByRef: (_ref: CacheRef) => Promise.resolve(undefined),
      getOutputByRef: (_ref: CacheRef) => {
        blobRead = true;
        return Promise.resolve(new Blob([new Uint8Array([9, 9])]));
      },
    };
    const stream = await streamRefViaBacking(makeCacheRef({ $ref: "x://b" }), backing);
    expect(blobRead).toBe(true);
    expect(await collect(stream!)).toEqual([9, 9]);
  });

  it("returns undefined when async reader and blob both miss", async () => {
    const backing = {
      getOutputStreamByRef: (_ref: CacheRef) => Promise.resolve(undefined),
      getOutputByRef: (_ref: CacheRef) => Promise.resolve(undefined),
    };
    expect(await streamRefViaBacking(makeCacheRef({ $ref: "x://c" }), backing)).toBeUndefined();
  });

  it("leaves the synchronous reader path byte-identical (no Promise leak)", async () => {
    // A sync backing returns a live AsyncIterable directly, never a Promise.
    const backing = {
      getOutputStreamByRef: (_ref: CacheRef): AsyncIterable<Uint8Array> | undefined =>
        gen(new Uint8Array([7])),
    };
    const raw = backing.getOutputStreamByRef(makeCacheRef({ $ref: "x://d" }));
    expect(typeof (raw as unknown as Promise<unknown>)?.then).not.toBe("function");
    const stream = await streamRefViaBacking(makeCacheRef({ $ref: "x://d" }), backing);
    expect(await collect(stream!)).toEqual([7]);
  });
});

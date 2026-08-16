/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The streaming read helper `streamRefViaBacking` reads through a backing's
 * `getOutputStreamByRef`, which the interface declares as Promise-returning so
 * a DB store that cannot probe existence synchronously resolves a dangling ref
 * to `undefined` rather than to a truthy Promise.
 *
 * The type says Promise; the runtime must not depend on it. A JavaScript
 * implementation — or one compiled before the signature collapsed — can still
 * hand back a bare iterable, and the helper's `await` is a no-op on a
 * non-thenable, so those backings keep working. The last case pins that.
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

  it("still reads a backing that returns a bare iterable instead of a Promise", async () => {
    // The interface requires a Promise, so this shape is only reachable from
    // JavaScript or from an implementation compiled against the older
    // signature — hence the cast, which is the point of the test rather than a
    // convenience. `await` on a non-thenable is a no-op, so such a backing must
    // keep working; the cast is what lets the test prove it.
    const syncBacking = {
      getOutputStreamByRef: (_ref: CacheRef): AsyncIterable<Uint8Array> => gen(new Uint8Array([7])),
    } as unknown as Parameters<typeof streamRefViaBacking>[1];

    const raw = (
      syncBacking as unknown as { getOutputStreamByRef: (r: CacheRef) => unknown }
    ).getOutputStreamByRef(makeCacheRef({ $ref: "x://d" }));
    // The premise: this backing really is synchronous, so the assertion below
    // is measuring the no-op await rather than an ordinary Promise round-trip.
    expect(typeof (raw as { then?: unknown })?.then).not.toBe("function");

    const stream = await streamRefViaBacking(makeCacheRef({ $ref: "x://d" }), syncBacking);
    expect(await collect(stream!)).toEqual([7]);
  });
});

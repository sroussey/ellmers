/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, CacheRefResolver } from "@workglow/task-graph";
import { makeCacheRef, resolveOutput } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";

const ref = (key: string, size?: number, mime?: string): CacheRef =>
  makeCacheRef({ $ref: key, size, mime });

const fakeResolver =
  (table: Record<string, Blob | undefined>): CacheRefResolver =>
  async (r) =>
    table[r.$ref];

describe("resolveOutput", () => {
  it("returns primitives and non-ref objects unchanged", async () => {
    const resolver = vi.fn(fakeResolver({}));
    const input = { a: 1, b: "two", c: true, d: null };
    expect(await resolveOutput(input, resolver)).toEqual(input);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("does not walk JSON-Schema-shaped {$ref: string} objects (no brand)", async () => {
    // Brand discrimination matters here: a JSON-Schema $ref embedded in
    // metadata must NOT be passed to the cache resolver, since the cache
    // backing would treat the JSON-Schema pointer as a cache key. Identity is
    // preserved because the tree has no branded refs to resolve.
    const resolver = vi.fn<CacheRefResolver>();
    const input = { schema: { $ref: "#/$defs/Foo" }, name: "ok" };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.schema).toBe(input.schema);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resolves a top-level ref to bytes", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const table = { "cache://x": blob };
    const out = await resolveOutput(ref("cache://x") as unknown as Blob, fakeResolver(table));
    expect(out).toBe(blob);
  });

  it("resolves refs nested inside a plain object, leaving siblings alone", async () => {
    const audio = new Blob([new Uint8Array([9, 9, 9])]);
    const input = {
      transcript: "hello",
      audio: ref("cache://a", 3, "audio/wav") as unknown as Blob,
      meta: { lang: "en" },
    };
    const out = await resolveOutput(input, fakeResolver({ "cache://a": audio }));
    expect(out.transcript).toBe("hello");
    expect(out.audio).toBe(audio);
    expect(out.meta).toEqual({ lang: "en" });
  });

  it("resolves refs inside arrays", async () => {
    const b1 = new Blob([new Uint8Array([1])]);
    const b2 = new Blob([new Uint8Array([2])]);
    const input = [
      ref("cache://1") as unknown as Blob,
      "plain",
      ref("cache://2") as unknown as Blob,
    ];
    const out = await resolveOutput(input, fakeResolver({ "cache://1": b1, "cache://2": b2 }));
    expect(out[0]).toBe(b1);
    expect(out[1]).toBe("plain");
    expect(out[2]).toBe(b2);
  });

  it("treats Blob, ArrayBuffer, typed arrays, Date as opaque leaves (not walked)", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    const ab = new ArrayBuffer(8);
    const u8 = new Uint8Array([5, 6, 7]);
    const date = new Date(2026, 0, 1);
    const resolver = vi.fn<CacheRefResolver>();
    const input = { blob, ab, u8, date };
    const out = await resolveOutput(input, resolver);
    expect(out.blob).toBe(blob);
    expect(out.ab).toBe(ab);
    expect(out.u8).toBe(u8);
    expect(out.date).toBe(date);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("returns undefined for refs the resolver cannot resolve (best-effort)", async () => {
    const input = { audio: ref("cache://missing") as unknown as Blob };
    const out = await resolveOutput(input, fakeResolver({}));
    expect(out.audio).toBeUndefined();
  });

  it("propagates resolver rejections (caller-controlled error policy)", async () => {
    const failingResolver: CacheRefResolver = async () => {
      throw new Error("backing down");
    };
    await expect(
      resolveOutput({ x: ref("cache://k") as unknown as Blob }, failingResolver)
    ).rejects.toThrow("backing down");
  });

  it("resolves refs in deeply nested structures", async () => {
    const b = new Blob([new Uint8Array([42])]);
    const input = {
      level1: {
        level2: {
          items: [{ payload: ref("cache://deep") as unknown as Blob }],
        },
      },
    };
    const out = await resolveOutput(input, fakeResolver({ "cache://deep": b }));
    expect(out.level1.level2.items[0].payload).toBe(b);
  });

  it("honors a concurrency bound: never exceeds the configured maximum in flight", async () => {
    let inFlight = 0;
    let observedMax = 0;
    const resolver: CacheRefResolver = async (r) => {
      inFlight++;
      observedMax = Math.max(observedMax, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return new Blob([new Uint8Array([Number(r.$ref.slice(-1))])]);
    };
    const refs = Array.from({ length: 8 }, (_, i) => ref(`cache://r${i}`));
    await resolveOutput(refs as unknown as Blob[], resolver, { concurrency: 2 });
    expect(observedMax).toBeLessThanOrEqual(2);
  });

  it("with concurrency undefined runs all resolutions in parallel", async () => {
    let inFlight = 0;
    let observedMax = 0;
    const resolver: CacheRefResolver = async () => {
      inFlight++;
      observedMax = Math.max(observedMax, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return new Blob();
    };
    const refs = Array.from({ length: 6 }, (_, i) => ref(`cache://r${i}`));
    await resolveOutput(refs as unknown as Blob[], resolver);
    expect(observedMax).toBe(6);
  });

  it("returns without overflow on a self-referential input (no refs)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const a: any = { name: "loop" };
    a.self = a;
    const out: any = await resolveOutput(a, resolver);
    expect(resolver).not.toHaveBeenCalled();
    // No refs reachable, so identity is preserved (including the cycle).
    expect(out).toBe(a);
    expect(out.self).toBe(out);
  });

  it("resolves refs reachable through a cycle without overflow", async () => {
    const blob = new Blob([new Uint8Array([7])]);
    const a: any = { payload: ref("cache://r1") as unknown as Blob };
    // Cycle pointing back to the root.
    a.parent = a;
    const out: any = await resolveOutput(a, fakeResolver({ "cache://r1": blob }));
    expect(out.payload).toBe(blob);
    // The cycle is preserved: `parent` resolves to the ORIGINAL input (the
    // walker short-circuits a revisited object by reference rather than
    // attempting to rewrite the back-edge).
    expect(out.parent).toBe(a);
  });

  it("treats Error as an opaque leaf (own non-enumerable data preserved)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const err = new Error("boom");
    const input = { failure: err };
    const out = await resolveOutput(input, resolver);
    // Identity preserved (no refs to resolve).
    expect(out).toBe(input);
    expect(out.failure).toBe(err);
    expect(out.failure.message).toBe("boom");
    expect(out.failure instanceof Error).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats URL as an opaque leaf (prototype accessors keep working)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const url = new URL("https://example.com/path?q=1");
    const input = { target: url };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.target).toBe(url);
    expect(out.target.href).toBe("https://example.com/path?q=1");
    expect(out.target instanceof URL).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });
});

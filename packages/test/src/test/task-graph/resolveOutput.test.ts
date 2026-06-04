/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { resolveOutput } from "@workglow/task-graph";
import type { CacheRef, CacheRefResolver } from "@workglow/task-graph";

const ref = (key: string, size?: number, mime?: string): CacheRef => ({
  $ref: key,
  ...(size !== undefined ? { size } : {}),
  ...(mime !== undefined ? { mime } : {}),
});

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
});

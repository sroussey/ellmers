/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createEmitQueue } from "@workglow/ai";
import { describe, expect, it } from "vitest";

describe("emitQueue backpressure", () => {
  it("push() returns void below high-water and Promise at/above it", () => {
    const q = createEmitQueue<number>({ highWaterMark: 4, lowWaterMark: 2 });
    expect(q.push(1)).toBeUndefined();
    expect(q.push(2)).toBeUndefined();
    expect(q.push(3)).toBeUndefined();
    const fourth = q.push(4); // length === 4 → at high-water
    expect(fourth).toBeInstanceOf(Promise);
  });

  it("resolves the drain promise after the queue drops below low-water", async () => {
    const q = createEmitQueue<number>({ highWaterMark: 4, lowWaterMark: 2 });
    q.push(1);
    q.push(2);
    q.push(3);
    const drain = q.push(4) as Promise<void>;
    expect(drain).toBeInstanceOf(Promise);

    // Drain via an explicit iterator so we don't loop forever — we want to
    // observe the drain promise resolving partway through.
    const iter = q.iterable[Symbol.asyncIterator]();
    expect((await iter.next()).value).toBe(1);
    expect((await iter.next()).value).toBe(2);
    // Now length === 2 (== lowWaterMark). Per spec we resolve when
    // length <= lowWaterMark.
    await drain;
    // Finish draining.
    expect((await iter.next()).value).toBe(3);
    expect((await iter.next()).value).toBe(4);
  });

  it("resolves drain promises cleanly on close()", async () => {
    const q = createEmitQueue<number>({ highWaterMark: 2, lowWaterMark: 1 });
    q.push(1);
    const drain = q.push(2) as Promise<void>;
    expect(drain).toBeInstanceOf(Promise);
    q.close();
    await drain; // must not hang
  });

  it("resolves drain promises cleanly on fail()", async () => {
    const q = createEmitQueue<number>({ highWaterMark: 2, lowWaterMark: 1 });
    q.push(1);
    const drain = q.push(2) as Promise<void>;
    expect(drain).toBeInstanceOf(Promise);
    q.fail(new Error("boom"));
    await drain; // must not hang

    // Subsequent iteration surfaces the error.
    const iter = q.iterable[Symbol.asyncIterator]();
    // Drain the buffered events first (these were pushed before fail).
    expect((await iter.next()).value).toBe(1);
    expect((await iter.next()).value).toBe(2);
    await expect(iter.next()).rejects.toThrow(/boom/);
  });

  it("rejects nonsensical watermarks", () => {
    expect(() =>
      createEmitQueue<number>({ highWaterMark: 4, lowWaterMark: 4 })
    ).toThrow(/lowWaterMark/);
    expect(() =>
      createEmitQueue<number>({ highWaterMark: 1, lowWaterMark: 5 })
    ).toThrow(/lowWaterMark/);
  });

  it("buffered length keeps growing if the producer ignores backpressure", () => {
    const q = createEmitQueue<number>({ highWaterMark: 8, lowWaterMark: 2 });
    for (let i = 0; i < 1000; i++) q.push(i);
    // No iteration → all 1000 buffered. We confirm push didn't *drop*
    // anything (the queue does not throttle producers that ignore the
    // returned drain promise).
    expect(q.length).toBe(1000);
  });
});

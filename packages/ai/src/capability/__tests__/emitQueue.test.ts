/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createEmitQueue } from "@workglow/ai";
import { describe, expect, it } from "vitest";

describe("createEmitQueue", () => {
  it("yields pushed values in order", async () => {
    const q = createEmitQueue<number>();
    q.push(1);
    q.push(2);
    q.close();

    const out: number[] = [];
    for await (const v of q.iterable) out.push(v);
    expect(out).toEqual([1, 2]);
  });

  it("waits for pushes that arrive after iteration starts", async () => {
    const q = createEmitQueue<string>();
    const out: string[] = [];
    const consumer = (async () => {
      for await (const v of q.iterable) out.push(v);
    })();
    await Promise.resolve();
    q.push("a");
    await Promise.resolve();
    q.push("b");
    q.close();
    await consumer;
    expect(out).toEqual(["a", "b"]);
  });

  it("throws the error from fail() into the consumer", async () => {
    const q = createEmitQueue<number>();
    q.push(1);
    q.fail(new Error("boom"));

    const out: number[] = [];
    let caught: unknown;
    try {
      for await (const v of q.iterable) out.push(v);
    } catch (err) {
      caught = err;
    }
    expect(out).toEqual([1]);
    expect((caught as Error).message).toBe("boom");
  });

  it("drops further pushes after close()", async () => {
    const q = createEmitQueue<number>();
    q.push(1);
    q.close();
    q.push(2); // late push — must not be yielded
    const out: number[] = [];
    for await (const v of q.iterable) out.push(v);
    expect(out).toEqual([1]);
  });
});

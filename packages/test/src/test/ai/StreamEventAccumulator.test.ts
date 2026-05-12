/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamEventAccumulator } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

interface Out {
  text?: string;
  count?: number;
  items?: unknown[];
  [key: string]: unknown;
}

describe("StreamEventAccumulator", () => {
  it("returns finish data verbatim when no deltas observed (one-shot)", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observeFinish({ type: "finish", data: { count: 42 } });
    expect(acc.materialize()).toEqual({ count: 42 });
  });

  it("concatenates text-delta per port", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({ type: "text-delta", port: "text", textDelta: "Hel" } as StreamEvent<Out>);
    acc.observe({ type: "text-delta", port: "text", textDelta: "lo" } as StreamEvent<Out>);
    acc.observeFinish({ type: "finish", data: {} });
    expect(acc.materialize()).toEqual({ text: "Hello" });
  });

  it("replaces object-delta non-array payloads (latest wins)", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({ type: "object-delta", port: "obj", objectDelta: { a: 1 } } as StreamEvent<Out>);
    acc.observe({ type: "object-delta", port: "obj", objectDelta: { a: 1, b: 2 } } as StreamEvent<Out>);
    acc.observeFinish({ type: "finish", data: {} });
    expect(acc.materialize()).toEqual({ obj: { a: 1, b: 2 } });
  });

  it("upserts array object-delta items by id", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({
      type: "object-delta", port: "items",
      objectDelta: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
    } as StreamEvent<Out>);
    acc.observe({
      type: "object-delta", port: "items",
      objectDelta: [{ id: 1, name: "A" }],
    } as StreamEvent<Out>);
    acc.observeFinish({ type: "finish", data: {} });
    expect(acc.materialize()).toEqual({ items: [{ id: 1, name: "A" }, { id: 2, name: "b" }] });
  });

  it("throws when both text-delta and object-delta were observed", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent<Out>);
    acc.observe({ type: "object-delta", port: "obj", objectDelta: { a: 1 } } as StreamEvent<Out>);
    acc.observeFinish({ type: "finish", data: {} });
    expect(() => acc.materialize()).toThrow(/mixed/i);
  });

  it("throws on error event", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent<Out>);
    expect(() => acc.observe({ type: "error", error: new Error("boom") } as StreamEvent<Out>))
      .toThrow(/boom/);
  });

  it("ignores phase events", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({ type: "phase", message: "Loading", progress: 0.5 } as StreamEvent<Out>);
    acc.observeFinish({ type: "finish", data: { count: 1 } });
    expect(acc.materialize()).toEqual({ count: 1 });
  });

  it("throws when no finish was observed", () => {
    const acc = new StreamEventAccumulator<Out>();
    acc.observe({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent<Out>);
    expect(() => acc.materialize()).toThrow(/finish/i);
  });
});

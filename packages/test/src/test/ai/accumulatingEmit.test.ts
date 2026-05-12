/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { accumulatingEmit } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

interface Out {
  text?: string;
  count?: number;
  [key: string]: unknown;
}

describe("accumulatingEmit", () => {
  it("captures a one-shot finish event", () => {
    const { emit, result } = accumulatingEmit<Out>();
    emit({ type: "finish", data: { count: 7 } } as StreamEvent<Out>);
    expect(result()).toEqual({ count: 7 });
  });

  it("captures text-delta events and an empty finish", () => {
    const { emit, result } = accumulatingEmit<Out>();
    emit({ type: "text-delta", port: "text", textDelta: "Hel" } as StreamEvent<Out>);
    emit({ type: "text-delta", port: "text", textDelta: "lo" } as StreamEvent<Out>);
    emit({ type: "finish", data: {} } as StreamEvent<Out>);
    expect(result()).toEqual({ text: "Hello" });
  });

  it("throws when result() is called before finish", () => {
    const { emit, result } = accumulatingEmit<Out>();
    emit({ type: "text-delta", port: "text", textDelta: "x" } as StreamEvent<Out>);
    expect(() => result()).toThrow(/finish/i);
  });

  it("error event thrown inside emit() propagates to caller", () => {
    const { emit } = accumulatingEmit<Out>();
    expect(() => emit({ type: "error", error: new Error("boom") } as StreamEvent<Out>)).toThrow(
      /boom/
    );
  });
});

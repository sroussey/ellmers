/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `streamEventCost` is approximate backpressure accounting: text deltas cost
 * UTF-16 code units (not UTF-8 bytes — no encoder pass on the hot path),
 * object deltas their JSON length, binary deltas their byte length, and
 * control events nothing. Deterministic per event, so independent charge and
 * credit sites always agree.
 */

import type { StreamEvent } from "@workglow/task-graph";
import { streamEventCost } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("streamEventCost", () => {
  it("charges text deltas by UTF-16 code units, not UTF-8 bytes", () => {
    expect(
      streamEventCost({ type: "text-delta", port: "t", textDelta: "hello" } as StreamEvent)
    ).toBe(5);
    // "héllo" is 6 UTF-8 bytes but 5 UTF-16 units.
    expect(
      streamEventCost({ type: "text-delta", port: "t", textDelta: "héllo" } as StreamEvent)
    ).toBe(5);
    // Astral characters count as their surrogate pair (2 units).
    expect(streamEventCost({ type: "text-delta", port: "t", textDelta: "𝄞" } as StreamEvent)).toBe(
      2
    );
  });

  it("charges object deltas by JSON-encoded length", () => {
    const objectDelta = { a: 1, b: "two" };
    expect(streamEventCost({ type: "object-delta", port: "t", objectDelta } as StreamEvent)).toBe(
      JSON.stringify(objectDelta).length
    );
  });

  it("charges binary deltas by byte length and control events nothing", () => {
    expect(
      streamEventCost({
        type: "binary-delta",
        port: "t",
        binaryDelta: new Uint8Array(7),
      } as StreamEvent)
    ).toBe(7);
    expect(streamEventCost({ type: "finish", data: {} } as StreamEvent)).toBe(0);
    expect(
      streamEventCost({ type: "snapshot", data: { big: "x".repeat(100) } } as StreamEvent)
    ).toBe(0);
  });
});

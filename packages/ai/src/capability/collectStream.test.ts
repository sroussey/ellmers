/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, expectTypeOf } from "vitest";
import { collectStream } from "./collectStream";
import type { StreamEvent } from "./StreamEvents";
import type { Capability } from "./Capabilities";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* makeStream<T>(...events: StreamEvent<T>[]): AsyncIterable<StreamEvent<T>> {
  for (const event of events) {
    yield event;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectStream", () => {
  it("delta accumulation: concatenates text-delta events and returns string on finish", async () => {
    type Output = { text: string };
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "text-delta", port: "text", textDelta: ", " },
      { type: "text-delta", port: "text", textDelta: "world!" },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    expect(result).toBe("Hello, world!");
  });

  it("one-shot: returns finish data directly when no delta events arrive", async () => {
    type Output = { embedding: number[] };
    const expected: Output = { embedding: [0.1, 0.2, 0.3] };
    const stream = makeStream<Output>({ type: "finish", data: expected });
    const result = await collectStream(stream);
    expect(result).toEqual(expected);
  });

  it("error: throws when stream ends without a finish event", async () => {
    type Output = { text: string };
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "incomplete" }
    );
    await expect(collectStream(stream)).rejects.toThrow("finish");
  });

  it("error: throws when a StreamError event is yielded", async () => {
    type Output = { text: string };
    const err = new Error("provider failure");
    const stream = makeStream<Output>({ type: "error", error: err });
    await expect(collectStream(stream)).rejects.toThrow("provider failure");
  });

  it("phase events are ignored and do not prevent one-shot result", async () => {
    type Output = { tokens: number };
    const expected: Output = { tokens: 42 };
    const stream = makeStream<Output>(
      { type: "phase", message: "Tokenizing", progress: undefined },
      { type: "finish", data: expected }
    );
    const result = await collectStream(stream);
    expect(result).toEqual(expected);
  });

  it("object-delta accumulation: merges object deltas and returns on finish", async () => {
    type Output = { result: Record<string, unknown> };
    const stream = makeStream<Output>(
      { type: "object-delta", port: "result", objectDelta: { a: 1 } },
      { type: "object-delta", port: "result", objectDelta: { b: 2 } },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream) as unknown as Record<string, unknown>;
    expect(result).toMatchObject({ result: { a: 1, b: 2 } });
  });

  // -------------------------------------------------------------------------
  // Type test: Capability rejects unknown strings at compile time.
  // -------------------------------------------------------------------------
  it("type: Capability only accepts known capability strings", () => {
    // Valid capability — must not produce a type error.
    const valid: Capability = "text.generation";
    expect(valid).toBe("text.generation");

    // Unknown string must not be assignable to Capability.
    // @ts-expect-error — "unknown.capability" is not a valid Capability key.
    const invalid: Capability = "unknown.capability";
    // Suppress "unused variable" warning — the value is intentionally unused.
    void invalid;

    // Runtime guard: expectTypeOf confirms the type is not `string`.
    expectTypeOf<Capability>().not.toEqualTypeOf<string>();
  });
});

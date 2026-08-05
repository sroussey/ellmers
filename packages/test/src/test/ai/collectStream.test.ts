/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Capability, collectStream, type StreamEvent, type Usage } from "@workglow/ai";
import { describe, expect, expectTypeOf, it } from "vitest";

function usage(partial: Partial<Usage>): Usage {
  return {
    input: undefined,
    output: undefined,
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: undefined,
    ...partial,
  };
}

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
  it("delta accumulation: concatenates text-delta events and returns per-port object on finish", async () => {
    type Output = { text: string };
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "text-delta", port: "text", textDelta: ", " },
      { type: "text-delta", port: "text", textDelta: "world!" },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    expect(result).toEqual({ text: "Hello, world!" });
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
    const stream = makeStream<Output>({
      type: "text-delta",
      port: "text",
      textDelta: "incomplete",
    });
    await expect(collectStream(stream)).rejects.toThrow("finish");
  });

  it("error: throws when a StreamError event is yielded", async () => {
    type Output = { text: string };
    const err = new Error("provider failure");
    const stream = makeStream<Output>({ type: "error", error: err });
    await expect(collectStream(stream)).rejects.toThrow("provider failure");
  });

  it("error: throws when StreamError arrives after text-delta events have accumulated", async () => {
    type Output = { text: string };
    const err = new Error("late failure");
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "partial" },
      { type: "text-delta", port: "text", textDelta: " data" },
      { type: "error", error: err }
    );
    // Must throw and must NOT return the partial accumulator.
    await expect(collectStream(stream)).rejects.toThrow("late failure");
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

  it("object-delta non-array: uses replace semantics (last delta wins per port)", async () => {
    type Output = { result: Record<string, unknown> };
    const stream = makeStream<Output>(
      { type: "object-delta", port: "result", objectDelta: { a: 1 } },
      { type: "object-delta", port: "result", objectDelta: { a: 1, b: 2 } },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    // Replace semantics: last delta replaces previous — result is { a:1, b:2 }, not a merge artifact
    expect(result).toEqual({ result: { a: 1, b: 2 } });
  });

  it("object-delta non-array: replace semantics — a key absent in later delta is NOT preserved", async () => {
    type Output = { result: Record<string, unknown> };
    const stream = makeStream<Output>(
      { type: "object-delta", port: "result", objectDelta: { a: 1, b: 99 } },
      // Second delta is a more complete snapshot that drops 'b'
      { type: "object-delta", port: "result", objectDelta: { a: 1, c: 3 } },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    // Replace: second delta wins wholesale — b must NOT appear
    expect(result).toEqual({ result: { a: 1, c: 3 } });
  });

  it("object-delta array: upserts items by id", async () => {
    type Output = { items: unknown[] };
    const stream = makeStream<Output>(
      { type: "object-delta", port: "items", objectDelta: [{ id: "a", v: 1 }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: "b", v: 2 }] },
      { type: "object-delta", port: "items", objectDelta: [{ id: "a", v: 99 }] },
      { type: "finish", data: {} as Output }
    );
    const result = (await collectStream(stream)) as unknown as Record<string, unknown[]>;
    // id "a" updated in-place, id "b" preserved
    expect(result["items"]).toEqual([
      { id: "a", v: 99 },
      { id: "b", v: 2 },
    ]);
  });

  it("snapshot (replace) mode: last snapshot wins, finish data merged on top", async () => {
    type Output = { text: string; extra?: string };
    const stream = makeStream<Output>(
      { type: "snapshot", data: { text: "first" } },
      { type: "snapshot", data: { text: "second" } },
      { type: "finish", data: { extra: "meta" } as Output }
    );
    const result = await collectStream(stream);
    expect(result).toEqual({ text: "second", extra: "meta" });
  });

  it("snapshot (replace) mode: snapshot only, empty finish data returns snapshot", async () => {
    type Output = { value: number };
    const stream = makeStream<Output>(
      { type: "snapshot", data: { value: 42 } },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    expect(result).toEqual({ value: 42 });
  });

  it("multi-port text-delta: returns per-port object preserving all ports", async () => {
    type Output = { text: string; summary: string };
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "text-delta", port: "summary", textDelta: "Hi" },
      { type: "text-delta", port: "text", textDelta: " world" },
      { type: "text-delta", port: "summary", textDelta: " there" },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    expect(result).toEqual({ text: "Hello world", summary: "Hi there" });
  });

  it("mixed text+object deltas on distinct ports: composes into one object", async () => {
    type Output = Record<string, unknown>;
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "hello" },
      { type: "object-delta", port: "result", objectDelta: { a: 1 } },
      { type: "finish", data: {} as Output }
    );
    await expect(collectStream(stream)).resolves.toEqual({ text: "hello", result: { a: 1 } });
  });

  it("first finish wins: duplicate finish event does not corrupt result", async () => {
    type Output = { value: number };
    // The generator deliberately yields two finish events.
    async function* twoFinishes(): AsyncIterable<StreamEvent<Output>> {
      yield { type: "finish", data: { value: 1 } };
      yield { type: "finish", data: { value: 2 } };
    }
    const result = await collectStream(twoFinishes());
    expect(result).toEqual({ value: 1 });
  });

  it("finish with non-empty data merged on top of object-delta accumulation", async () => {
    type Output = { result: Record<string, unknown>; meta: string };
    const stream = makeStream<Output>(
      { type: "object-delta", port: "result", objectDelta: { a: 1 } },
      { type: "finish", data: { meta: "done" } as Output }
    );
    const result = await collectStream(stream);
    expect(result).toMatchObject({ result: { a: 1 }, meta: "done" });
  });

  // -------------------------------------------------------------------------
  // Usage channel
  // -------------------------------------------------------------------------

  it("usage: finish usage surfaces as result.usage alongside accumulated deltas", async () => {
    type Output = { text: string };
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "finish", data: {} as Output, usage: usage({ input: 12, output: 3 }) }
    );
    const result = (await collectStream(stream)) as Output & { usage?: Usage };
    expect(result.text).toBe("Hello");
    expect(result.usage).toEqual(usage({ input: 12, output: 3 }));
  });

  it("usage: a stream with no usage leaves no usage key at all", async () => {
    type Output = { text: string };
    const stream = makeStream<Output>(
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "finish", data: {} as Output }
    );
    const result = await collectStream(stream);
    expect(result).toEqual({ text: "Hello" });
    expect("usage" in (result as object)).toBe(false);
  });

  it("usage: one-shot finish keeps data as the payload (embedding-shaped run-fn)", async () => {
    type Output = { embedding: number[] };
    const stream = makeStream<Output>({
      type: "finish",
      data: { embedding: [0.1, 0.2] },
      usage: usage({ input: 8, total: 8 }),
    });
    const result = (await collectStream(stream)) as Output & { usage?: Usage };
    expect(result.embedding).toEqual([0.1, 0.2]);
    expect(result.usage).toEqual(usage({ input: 8, total: 8 }));
  });

  it("usage: json-mode finish keeps data.object intact next to usage", async () => {
    type Output = { object: Record<string, unknown> };
    const stream = makeStream<Output>(
      { type: "object-delta", port: "object", objectDelta: { name: "A" } },
      {
        type: "finish",
        data: { object: { name: "Alice", age: 30 } },
        usage: usage({ input: 40, output: 12 }),
      }
    );
    const result = (await collectStream(stream)) as Output & { usage?: Usage };
    // Deltas win on the `object` port; the usage sibling is untouched by that.
    expect(result.object).toEqual({ name: "A" });
    expect(result.usage).toEqual(usage({ input: 40, output: 12 }));
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

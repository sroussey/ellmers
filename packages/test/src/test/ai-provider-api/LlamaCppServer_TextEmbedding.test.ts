/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createLlamaCppServerTextEmbeddingStream } from "@workglow/llamacpp-server/ai-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const model = { provider_config: { base_url: "http://localhost:8080", model_name: "emb" } } as any;

describe("createLlamaCppServerTextEmbeddingStream", () => {
  it("returns a single Float32Array for string input", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const fn = createLlamaCppServerTextEmbeddingStream({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ text: "hello" } as any, model, undefined as any, emit);
    const finish = events.find((e) => e.type === "finish")!;
    expect(finish.data.vector).toBeInstanceOf(Float32Array);
    const arr = Array.from(finish.data.vector as Float32Array);
    expect(arr).toHaveLength(3);
    expect(arr[0]).toBeCloseTo(0.1, 5);
    expect(arr[1]).toBeCloseTo(0.2, 5);
    expect(arr[2]).toBeCloseTo(0.3, 5);
  });

  it("returns an array of Float32Arrays for string[] input", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const fn = createLlamaCppServerTextEmbeddingStream({});
    const events: any[] = [];
    const emit = (e: any) => events.push(e);
    await fn({ text: ["a", "b"] } as any, model, undefined as any, emit);
    const finish = events.find((e) => e.type === "finish")!;
    expect(Array.isArray(finish.data.vector)).toBe(true);
    expect(finish.data.vector).toHaveLength(2);
    expect(finish.data.vector[0]).toBeInstanceOf(Float32Array);
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 500 }));
    const fn = createLlamaCppServerTextEmbeddingStream({});
    const emit = (_e: any) => undefined;
    await expect(fn({ text: "x" } as any, model, undefined as any, emit)).rejects.toThrow(
      /embeddings/
    );
  });

  it("throws when /v1/embeddings returns fewer embeddings than inputs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const fn = createLlamaCppServerTextEmbeddingStream({});
    const emit = (_e: any) => undefined;
    await expect(fn({ text: "x" } as any, model, undefined as any, emit)).rejects.toThrow(
      /returned 0 embeddings for 1 input/
    );
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { _testOnly } from "@workglow/google-gemini/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { GEMINI_RUN_FNS } = _testOnly;

function findStructuredGenerationRunFn(): AiProviderRunFn {
  const registration = GEMINI_RUN_FNS.find(
    ({ serves }) =>
      (serves as readonly string[]).includes("json-mode") &&
      (serves as readonly string[]).includes("text.generation")
  );
  if (!registration) throw new Error("no Gemini run-fn registered for json-mode,text.generation");
  return registration.runFn as AiProviderRunFn;
}

/**
 * Encode streaming chunks in the SSE wire format `@google/genai` parses:
 * one `data: {json}` frame per chunk.
 */
function sseResponse(chunks: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const model = {
  model_id: "gemini-x",
  provider_config: { model_name: "gemini-3-flash-preview", api_key: "test-key" },
} as never;

/** Both spellings of "a nullable number", which the SDK must normalize alike. */
const ANYOF_SPELLING = {
  type: "object",
  required: ["a"],
  properties: { a: { anyOf: [{ type: "number" }, { type: "null" }] } },
};

const TYPE_ARRAY_SPELLING = {
  type: "object",
  required: ["a"],
  properties: { a: { type: ["number", "null"] } },
};

/**
 * Wire-level pin on `@google/genai`'s own request converter.
 *
 * `rewriteNullableUnionsForStrict` runs in the Gemini structured-generation
 * run-fn, rewriting `anyOf: [T, null]` to `type: [T, "null"]`. That rewrite is
 * a strict-mode accommodation for the OpenAI-shaped providers and is
 * SHAPE-NEUTRAL for Gemini: the SDK's `processJsonSchema` calls
 * `flattenTypeArrayToAnyOf`, which folds a `"null"` member into
 * `nullable: true`, so both spellings serialize to the same `responseSchema`.
 * These tests assert that equivalence against the real serialized body, so an
 * SDK upgrade that drops `flattenTypeArrayToAnyOf` fails here rather than in
 * production, where a rewritten schema would reach Gemini as an unrecognized
 * type array.
 *
 * The existing fake-client tests cannot cover this: `fakeGeminiClient` replaces
 * `ai.models.generateContentStream`, which intercepts ABOVE the SDK's `tSchema`
 * converter — the code under test here. So this suite uses the REAL SDK client
 * and spies on `fetch` instead of calling `setGeminiClientForTests`.
 */
describe("Gemini request body normalizes both nullable spellings", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function capturedResponseSchema(schema: unknown): Promise<unknown> {
    fetchSpy.mockResolvedValueOnce(
      sseResponse([{ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }])
    );

    const runFn = findStructuredGenerationRunFn();
    await runFn(
      { prompt: "hi", outputSchema: schema } as never,
      model,
      undefined as never,
      () => {}
    );

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      generationConfig?: { responseSchema?: unknown };
    };
    return body.generationConfig?.responseSchema;
  }

  const EXPECTED = {
    type: "OBJECT",
    required: ["a"],
    properties: { a: { nullable: true, type: "NUMBER" } },
  };

  it("serializes an anyOf [T, null] property to nullable:true", async () => {
    expect(await capturedResponseSchema(ANYOF_SPELLING)).toEqual(EXPECTED);
  });

  it("serializes a type:[T,'null'] property to the same nullable:true", async () => {
    expect(await capturedResponseSchema(TYPE_ARRAY_SPELLING)).toEqual(EXPECTED);
  });
});

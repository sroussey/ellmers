/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { GOOGLE_GEMINI, _testOnly } from "@workglow/google-gemini/ai";
import { _testOnly as runtimeTestOnly } from "@workglow/google-gemini/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const geminiRequests: Array<Record<string, unknown>> = [];

const fakeGeminiClient = {
  models: {
    generateContentStream: async (request: Record<string, unknown>) => {
      geminiRequests.push(request);
      return { async *[Symbol.asyncIterator]() {} };
    },
  },
  caches: { create: async () => ({}), delete: async () => {} },
} as never;

beforeEach(() => {
  geminiRequests.length = 0;
  _testOnly.setGeminiClientForTests(fakeGeminiClient);
  runtimeTestOnly.setGeminiClientForTests(fakeGeminiClient);
});

afterEach(() => {
  _testOnly.setGeminiClientForTests(undefined);
  runtimeTestOnly.setGeminiClientForTests(undefined);
});

function findGeminiRunFn(capability: string): AiProviderRunFn {
  const registration = _testOnly.GEMINI_RUN_FNS.find(({ serves }) =>
    (serves as readonly string[]).includes(capability)
  );
  expect(registration).toBeDefined();
  return registration!.runFn as AiProviderRunFn;
}

const model = {
  provider: GOOGLE_GEMINI,
  provider_config: { api_key: "test-key", model_name: "gemini-test" },
} as never;

describe("Gemini structured generation schema", () => {
  it("sends responseSchema after rewriting TypeBox nullable unions", async () => {
    const runFn = findGeminiRunFn("json-mode");
    const nullableSchema = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { anyOf: [{ type: "number" }, { type: "null" }] } },
    };

    await runFn(
      { prompt: "hi", outputSchema: nullableSchema } as never,
      model,
      undefined as never,
      (() => {}) as never,
      undefined as never
    );

    const request = geminiRequests.at(-1) as Record<string, unknown>;
    const config = request.config as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema).toEqual({
      type: "object",
      required: ["a"],
      properties: { a: { type: ["number", "null"] } },
    });

    const contents = request.contents as Array<{
      parts: Array<{ text: string }>;
    }>;
    expect(contents[0]?.parts[0]?.text).toBe("hi");
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { GOOGLE_GEMINI, _testOnly } from "@workglow/google-gemini/ai";
import { _testOnly as runtimeTestOnly } from "@workglow/google-gemini/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Gemini is the only CLOUD provider here that exposes a sampling seed: the
 * OpenAI Responses API rejects one outright (`400 Unknown parameter: 'seed'`)
 * and Anthropic has none. The local providers (node-llama-cpp, transformers.js)
 * already carry `provider_config.seed`, so this puts Gemini on the same footing
 * and makes it the one cloud path to reproducible generation.
 */
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

const modelWith = (extra: Record<string, unknown>) =>
  ({
    provider: GOOGLE_GEMINI,
    provider_config: { api_key: "test-key", model_name: "gemini-test", ...extra },
  }) as never;

const lastConfig = () => geminiRequests.at(-1)?.config as Record<string, unknown> | undefined;

describe("Gemini sampling seed", () => {
  it("sends provider_config.seed on a structured-generation request", async () => {
    const runFn = findGeminiRunFn("json-mode");
    await runFn(
      { prompt: "hi", outputSchema: { type: "object", properties: {} } } as never,
      modelWith({ seed: 42 }),
      undefined as never,
      (() => {}) as never,
      undefined as never
    );
    expect(lastConfig()?.seed).toBe(42);
  });

  it("omits the field entirely when no seed is configured", async () => {
    // Sending `seed: undefined` would still serialise the key on some clients;
    // an unset seed must leave the model's own sampling untouched.
    const runFn = findGeminiRunFn("json-mode");
    await runFn(
      { prompt: "hi", outputSchema: { type: "object", properties: {} } } as never,
      modelWith({}),
      undefined as never,
      (() => {}) as never,
      undefined as never
    );
    expect(lastConfig()?.seed).toBeUndefined();
  });

  it("sends the seed on a text-generation request too", async () => {
    const runFn = findGeminiRunFn("text.generation");
    await runFn(
      { prompt: "hi" } as never,
      modelWith({ seed: 7 }),
      undefined as never,
      (() => {}) as never,
      undefined as never
    );
    expect(lastConfig()?.seed).toBe(7);
  });

  it("accepts seed 0 rather than treating it as unset", async () => {
    // 0 is a legitimate seed; a truthiness check would silently drop it.
    const runFn = findGeminiRunFn("text.generation");
    await runFn(
      { prompt: "hi" } as never,
      modelWith({ seed: 0 }),
      undefined as never,
      (() => {}) as never,
      undefined as never
    );
    expect(lastConfig()?.seed).toBe(0);
  });
});

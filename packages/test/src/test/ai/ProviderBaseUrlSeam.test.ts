/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contract test: every HTTP provider must honor
 * provider_config.base_url so a future proxy target can repoint them at
 * /api/ai/<provider> without changing provider code.
 *
 * These are constructor-only assertions — no network requests are sent.
 * The dummy api_key prevents resolveApiKey() from throwing due to a missing
 * environment variable.
 *
 * Coverage:
 *   - Anthropic: getClient() from @workglow/anthropic/ai-runtime — COVERED
 *   - OpenAI:    getClient() from @workglow/openai/ai-runtime    — COVERED
 *   - Ollama:    getClient() from @workglow/ollama/ai-runtime     — MANUAL REVIEW
 *       The Ollama SDK stores the host on `protected readonly config` (not a
 *       public property), so no assertable property is available from outside
 *       the class. The pass-through is trivially visible in Ollama_Client.ts:
 *       `new Ollama({ host: model?.provider_config?.base_url || DEFAULT })`.
 *   - Gemini:    no getClient() builder; key is resolved separately and the
 *       Google Generative AI SDK does not expose a configurable base URL via
 *       the same pattern — MANUAL REVIEW.
 */

import { getClient as getAnthropicClient } from "@workglow/anthropic/ai-runtime";
import { getClient as getOpenAiClient } from "@workglow/openai/ai-runtime";
import { describe, expect, it } from "vitest";

const LOCAL = "http://127.0.0.1:9/api/ai";

describe("HTTP provider base_url repointing seam", () => {
  it("Anthropic client honors provider_config.base_url", async () => {
    const client = await getAnthropicClient({
      provider: "ANTHROPIC",
      provider_config: {
        model_name: "claude-test",
        api_key: "test-key",
        base_url: LOCAL,
      },
    } as any);
    expect(client.baseURL).toBe(LOCAL);
  });

  it("OpenAI client honors provider_config.base_url", async () => {
    const client = await getOpenAiClient({
      provider: "OPENAI",
      provider_config: {
        model_name: "gpt-test",
        api_key: "test-key",
        base_url: LOCAL,
      },
    } as any);
    expect(client.baseURL).toBe(LOCAL);
  });
});

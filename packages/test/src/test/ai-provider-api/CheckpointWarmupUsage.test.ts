/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiSessionContext,
  CacheCheckpointTaskInput,
  CacheCheckpointTaskOutput,
} from "@workglow/ai";
import { mapOpenAIResponsesUsage } from "@workglow/ai/provider-utils";
import { _testOnly as anthropicTestOnly } from "@workglow/anthropic/ai";
import { _testOnly as anthropicRuntimeTestOnly } from "@workglow/anthropic/ai-runtime";
import { _testOnly as openAiTestOnly } from "@workglow/openai/ai";
import { _testOnly as openAiRuntimeTestOnly } from "@workglow/openai/ai-runtime";
import type { StreamEvent, StreamFinish } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { mapAnthropicUsage } = anthropicTestOnly;

describe("checkpoint warm-up usage mapping", () => {
  it("maps a non-streaming Anthropic response usage payload", () => {
    // A warm-up writes the whole prefix into cache and generates one token, so
    // cacheWrite carries the cost and input is only the throwaway tail.
    const usage = mapAnthropicUsage({
      input_tokens: 4,
      output_tokens: 1,
      cache_creation_input_tokens: 12_000,
      cache_read_input_tokens: 0,
    });

    expect(usage).toEqual({
      input: 4,
      output: 1,
      cached: 0,
      cacheWrite: 12_000,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    });
  });

  it("reports nothing for a payload with no counters", () => {
    expect(mapAnthropicUsage(undefined)).toBe(undefined);
    expect(mapAnthropicUsage({})).toBe(undefined);
  });
});

describe("OpenAI Responses usage mapping", () => {
  it("maps a non-streaming Responses usage payload with a stated cache-miss", () => {
    // A first write has nothing to hit, so the provider states cached: 0
    // rather than leaving the field unreported.
    const usage = mapOpenAIResponsesUsage({
      input_tokens: 12_000,
      output_tokens: 16,
      total_tokens: 12_016,
      input_tokens_details: { cached_tokens: 0 },
    });

    expect(usage).toEqual({
      input: 12_000,
      output: 16,
      cached: 0,
      cacheWrite: undefined,
      reasoning: undefined,
      total: 12_016,
      extra: undefined,
    });
  });

  it("reports nothing for a payload with no counters", () => {
    expect(mapOpenAIResponsesUsage(undefined)).toBe(undefined);
    expect(mapOpenAIResponsesUsage({})).toBe(undefined);
  });
});

/** Registration lookup — first Anthropic entry whose `serves` includes the capability. */
function findAnthropicRunFn(capability: string): AiProviderRunFn {
  const registration = anthropicTestOnly.ANTHROPIC_RUN_FNS.find(({ serves }) =>
    (serves as readonly string[]).includes(capability)
  );
  expect(registration).toBeDefined();
  return registration!.runFn as AiProviderRunFn;
}

/** Registration lookup — first OpenAI entry whose `serves` includes the capability. */
function findOpenAiRunFn(capability: string): AiProviderRunFn {
  const registration = openAiTestOnly.OPENAI_RUN_FNS.find(({ serves }) =>
    (serves as readonly string[]).includes(capability)
  );
  expect(registration).toBeDefined();
  return registration!.runFn as AiProviderRunFn;
}

/**
 * Wiring coverage for Task 16: the checkpoint warm-up run-fns must map the
 * real client response's usage payload onto the emitted `finish` event
 * (not merely prove the pure mapper functions are correct in isolation), and
 * must do so without disturbing the `checkpoint` handle `finish.data` already
 * carries.
 */
describe("Anthropic cache.checkpoint warm-up usage wiring", () => {
  const anthropicUsagePayload = {
    input_tokens: 4,
    output_tokens: 1,
    cache_creation_input_tokens: 12_000,
    cache_read_input_tokens: 0,
  };
  const fakeAnthropicClient = {
    messages: {
      create: async () => ({ usage: anthropicUsagePayload }),
    },
  } as never;
  const testModel = { provider_config: { model_name: "claude-test" } } as never;

  beforeEach(() => {
    anthropicTestOnly.setAnthropicClientForTests(fakeAnthropicClient);
    anthropicRuntimeTestOnly.setAnthropicClientForTests(fakeAnthropicClient);
  });

  afterEach(() => {
    anthropicTestOnly.setAnthropicClientForTests(undefined);
    anthropicRuntimeTestOnly.setAnthropicClientForTests(undefined);
  });

  it("emits the mapped usage on finish without clobbering the checkpoint handle", async () => {
    const runFn = findAnthropicRunFn("cache.checkpoint");
    const input: CacheCheckpointTaskInput = { model: "claude-test" };
    const session: AiSessionContext = {
      sessionId: "ckpt-anthropic-usage",
      prefix: {
        systemPrompt: "sys",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      },
    };
    const events: StreamEvent<CacheCheckpointTaskOutput>[] = [];
    await runFn(
      input,
      testModel,
      new AbortController().signal,
      (event) => events.push(event as StreamEvent<CacheCheckpointTaskOutput>),
      undefined,
      session
    );

    expect(events).toHaveLength(1);
    const finish = events[0] as StreamFinish<CacheCheckpointTaskOutput>;
    expect(finish.type).toBe("finish");
    // The handle must survive the usage spread untouched.
    expect(finish.data).toEqual({ checkpoint: "ckpt-anthropic-usage" });
    // A warm-up writes the whole prefix into cache and generates one token:
    // cacheWrite carries the prefix cost, input is only the throwaway tail.
    expect(finish.usage).toEqual({
      input: 4,
      output: 1,
      cached: 0,
      cacheWrite: 12_000,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    });
  });
});

describe("OpenAI cache.checkpoint warm-up usage wiring", () => {
  const openAiUsagePayload = {
    input_tokens: 12_000,
    output_tokens: 16,
    total_tokens: 12_016,
    input_tokens_details: { cached_tokens: 0 },
  };
  const fakeOpenAiClient = {
    responses: {
      create: async () => ({ usage: openAiUsagePayload }),
    },
  } as never;
  const testModel = { provider_config: { model_name: "gpt-test" } } as never;

  beforeEach(() => {
    openAiTestOnly.setOpenAIClientForTests(fakeOpenAiClient);
    openAiRuntimeTestOnly.setOpenAIClientForTests(fakeOpenAiClient);
  });

  afterEach(() => {
    openAiTestOnly.setOpenAIClientForTests(undefined);
    openAiRuntimeTestOnly.setOpenAIClientForTests(undefined);
  });

  it("emits the mapped usage on finish without clobbering the checkpoint handle", async () => {
    const runFn = findOpenAiRunFn("cache.checkpoint");
    const input: CacheCheckpointTaskInput = { model: "gpt-test" };
    const session: AiSessionContext = {
      sessionId: "ckpt-openai-usage",
      prefix: {
        systemPrompt: "sys",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      },
    };
    const events: StreamEvent<CacheCheckpointTaskOutput>[] = [];
    await runFn(
      input,
      testModel,
      new AbortController().signal,
      (event) => events.push(event as StreamEvent<CacheCheckpointTaskOutput>),
      undefined,
      session
    );

    expect(events).toHaveLength(1);
    const finish = events[0] as StreamFinish<CacheCheckpointTaskOutput>;
    expect(finish.type).toBe("finish");
    // The handle must survive the usage spread untouched.
    expect(finish.data).toEqual({ checkpoint: "ckpt-openai-usage" });
    // The whole prefix is the billed input; a first write has nothing to hit,
    // so cached is a stated 0 rather than unreported.
    expect(finish.usage).toEqual({
      input: 12_000,
      output: 16,
      cached: 0,
      cacheWrite: undefined,
      reasoning: undefined,
      total: 12_016,
      extra: undefined,
    });
  });
});

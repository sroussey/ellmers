/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  _testOnly,
  assertToolChoiceHonored,
  DeepSeekToolChoiceNotHonoredError,
  isForcingToolChoice,
} from "@workglow/deepseek/ai";
import { RetryableJobError } from "@workglow/job-queue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("isForcingToolChoice", () => {
  it("returns false for undefined, auto, and none", () => {
    expect(isForcingToolChoice(undefined)).toBe(false);
    expect(isForcingToolChoice("auto")).toBe(false);
    expect(isForcingToolChoice("none")).toBe(false);
  });

  it("returns true for required and a named function", () => {
    expect(isForcingToolChoice("required")).toBe(true);
    expect(isForcingToolChoice("get_weather")).toBe(true);
  });
});

describe("assertToolChoiceHonored", () => {
  it("throws DeepSeekToolChoiceNotHonoredError when required and no calls were made", () => {
    expect(() => assertToolChoiceHonored("required", [], "m")).toThrow(
      DeepSeekToolChoiceNotHonoredError
    );
  });

  it("does not throw when required and at least one valid call was made", () => {
    expect(() => assertToolChoiceHonored("required", ["get_weather"], "m")).not.toThrow();
  });

  it("throws with a diagnostic message when a named function was not called", () => {
    let caught: unknown;
    try {
      assertToolChoiceHonored("get_weather", ["send_email"], "m");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DeepSeekToolChoiceNotHonoredError);
    const message = (caught as Error).message;
    expect(message).toContain('expected a call to "get_weather"');
    expect(message).toContain("called: send_email");
  });

  it("throws an error that is an instance of RetryableJobError", () => {
    let caught: unknown;
    try {
      assertToolChoiceHonored("required", [], "m");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RetryableJobError);
  });
});

/**
 * DeepSeek is OpenAI-shaped but splits the prompt into cache hit/miss counters
 * of its own. The hit count is the cache-read figure; the miss count is what
 * makes its cache-miss-priced cost reconstructable, so it rides in `extra`.
 */
describe("DeepSeek usage from the terminal include_usage frame", () => {
  const { DEEPSEEK_RUN_FNS } = _testOnly;

  const textSummaryFn = (() => {
    const reg = DEEPSEEK_RUN_FNS.find((r) => [...r.serves].sort().join(",") === "text.summary");
    if (!reg) throw new Error("no DeepSeek run-fn registered for text.summary");
    return reg.runFn;
  })();

  const model = {
    model_id: "deepseek-x",
    provider_config: { model_name: "deepseek-chat", api_key: "test-key" },
  } as any;

  function sseResponse(chunks: readonly unknown[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function runSummary(chunks: readonly unknown[]) {
    fetchSpy.mockResolvedValueOnce(sseResponse(chunks));
    const events: any[] = [];
    await textSummaryFn({ text: "input" } as any, model, new AbortController().signal, (e: any) =>
      events.push(e)
    );
    return events.at(-1);
  }

  it("asks for usage and maps the cache hit/miss split", async () => {
    const finish = await runSummary([
      { choices: [{ delta: { content: "hi" } }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 88,
          completion_tokens: 21,
          total_tokens: 109,
          prompt_cache_hit_tokens: 64,
          prompt_cache_miss_tokens: 24,
        },
      },
    ]);

    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body.stream_options).toEqual({ include_usage: true });

    expect(finish.type).toBe("finish");
    expect(finish.usage).toEqual({
      input: 88,
      output: 21,
      cached: 64,
      cacheWrite: undefined,
      reasoning: undefined,
      total: 109,
      extra: { promptCacheMissTokens: 24 },
    });
  });

  it("leaves usage absent when the stream never reports it", async () => {
    const finish = await runSummary([{ choices: [{ delta: { content: "hi" } }] }]);
    expect(finish.usage).toBeUndefined();
  });

  it("omits extra entirely when no cache-miss count was reported", async () => {
    const finish = await runSummary([
      { choices: [{ delta: { content: "hi" } }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } },
    ]);
    expect(finish.usage.extra).toBeUndefined();
    expect(finish.usage.cached).toBeUndefined();
  });
});

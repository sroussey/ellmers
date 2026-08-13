/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/anthropic/ai";
import { getLogger } from "@workglow/util";
import { afterEach, describe, expect, it, vi } from "vitest";

const { anthropicAcceptsSamplingParams, applyAnthropicSamplingParams } = _testOnly;

function cfg(provider_config: Record<string, unknown>) {
  return { provider: "ANTHROPIC", provider_config } as never;
}

function model(modelName: string) {
  return cfg({ model_name: modelName });
}

describe("anthropicAcceptsSamplingParams — rejecting models", () => {
  // Every id here returns HTTP 400 when temperature/top_p is sent.
  const rejects = [
    "claude-opus-5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-mythos-preview",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ];

  it.each(rejects)("omits sampling params for %s", (id) => {
    expect(anthropicAcceptsSamplingParams(model(id))).toBe(false);
  });
});

describe("anthropicAcceptsSamplingParams — accepting models", () => {
  const accepts = [
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
    "claude-opus-4-1",
    // Regression: the trailing 8-digit segment is a release date, not minor 20250514.
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    // Regression: legacy `claude-<major>-<minor>-<family>` id shape.
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-20250219",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
    "claude-2.1",
  ];

  it.each(accepts)("sends sampling params for %s", (id) => {
    expect(anthropicAcceptsSamplingParams(model(id))).toBe(true);
  });
});

describe("anthropicAcceptsSamplingParams — safe default and override", () => {
  it("defaults to omitting for an unrecognized or future model id", () => {
    // A brand-new id matches no known-accepting shape, so params are omitted
    // and the request succeeds rather than failing with a 400.
    expect(anthropicAcceptsSamplingParams(model("claude-opus-6"))).toBe(false);
    expect(anthropicAcceptsSamplingParams(model("claude-quasar-9"))).toBe(false);
    expect(anthropicAcceptsSamplingParams(model("gpt-4o"))).toBe(false);
    expect(anthropicAcceptsSamplingParams(model(""))).toBe(false);
    expect(anthropicAcceptsSamplingParams(cfg({}))).toBe(false);
  });

  it("honors an explicit sampling_params override in both directions", () => {
    expect(
      anthropicAcceptsSamplingParams(cfg({ model_name: "claude-opus-5", sampling_params: "send" }))
    ).toBe(true);
    expect(
      anthropicAcceptsSamplingParams(
        cfg({ model_name: "claude-haiku-4-5", sampling_params: "omit" })
      )
    ).toBe(false);
  });
});

describe("applyAnthropicSamplingParams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns both wire names on an accepting model", () => {
    const params: Record<string, unknown> = {};
    applyAnthropicSamplingParams(
      params,
      { temperature: 0.4, topP: 0.9 },
      model("claude-haiku-4-5")
    );
    expect(params.temperature).toBe(0.4);
    expect(params.top_p).toBe(0.9);
  });

  it("leaves the keys absent on a rejecting model", () => {
    const params: Record<string, unknown> = {};
    applyAnthropicSamplingParams(params, { temperature: 0.4, topP: 0.9 }, model("claude-opus-5"));
    // Absent, not present-and-undefined — the SDK would serialize a null field.
    expect("temperature" in params).toBe(false);
    expect("top_p" in params).toBe(false);
  });

  it("does not warn when nothing was supplied", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    const params: Record<string, unknown> = {};
    applyAnthropicSamplingParams(params, {}, model("claude-opus-5"));
    expect(warn).not.toHaveBeenCalled();
    expect(params).toEqual({});
  });

  it("warns exactly once naming every dropped parameter", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    applyAnthropicSamplingParams({}, { temperature: 0.4, topP: 0.9 }, model("claude-opus-5"));
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = warn.mock.calls[0]?.[1] as { model: string; dropped: string[] };
    expect(meta.model).toBe("claude-opus-5");
    expect(meta.dropped).toEqual(["temperature", "top_p"]);
  });

  // A model can accept sampling parameters in general and still reject them on
  // a request carrying legacy extended thinking. `claude-haiku-4-5` is exactly
  // that case: it is on the accepting list, so before this guard a
  // thinking-configured run with a pinned temperature sent both and got a 400.
  it("drops sampling parameters when extended thinking is enabled", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    const params: Record<string, unknown> = {
      thinking: { type: "enabled", budget_tokens: 1024 },
    };
    applyAnthropicSamplingParams(params, { temperature: 0, topP: 0.9 }, model("claude-haiku-4-5"));
    expect("temperature" in params).toBe(false);
    expect("top_p" in params).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // Thinking bounds `top_p` rather than forbidding it: the API accepts
  // `>= 0.95`. Dropping such a value would discard a setting the request was
  // entitled to send, and with nothing dropped there is nothing to warn about.
  it("keeps an in-range top_p when extended thinking is enabled", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    const params: Record<string, unknown> = {
      thinking: { type: "enabled", budget_tokens: 1024 },
    };
    applyAnthropicSamplingParams(params, { topP: 0.98 }, model("claude-haiku-4-5"));
    expect(params.top_p).toBe(0.98);
    expect(warn).not.toHaveBeenCalled();
  });

  // `temperature` goes even when in range. Its only legal value under thinking
  // is the default, so dropping it cannot change the result — and keeping it
  // beside a surviving `top_p` would trip the separate rule that the two may
  // not both be specified, turning a legal request into a 400.
  it("drops temperature but keeps an in-range top_p under extended thinking", () => {
    const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
    const params: Record<string, unknown> = {
      thinking: { type: "enabled", budget_tokens: 1024 },
    };
    applyAnthropicSamplingParams(params, { temperature: 1, topP: 0.98 }, model("claude-haiku-4-5"));
    expect("temperature" in params).toBe(false);
    expect(params.top_p).toBe(0.98);
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = warn.mock.calls[0]![1] as { dropped: string[] };
    expect(meta.dropped).toEqual(["temperature"]);
  });

  // Scope guard: adaptive thinking on 4.6+ is the recommended configuration and
  // does accept sampling, so the suppression must key on "enabled" alone.
  it("keeps sampling parameters under adaptive thinking", () => {
    const params: Record<string, unknown> = { thinking: { type: "adaptive" } };
    applyAnthropicSamplingParams(params, { temperature: 0.4 }, model("claude-haiku-4-5"));
    expect(params.temperature).toBe(0.4);
  });
});

/**
 * Anthropic splits usage across two frames — `message_start` carries the prompt
 * side, `message_delta` the running completion side — and both restate
 * cumulative figures. The collector keeps the newest number per field; it never
 * adds counts of its own.
 */
describe("createAnthropicUsageCollector", () => {
  const { createAnthropicUsageCollector } = _testOnly;

  it("combines the prompt side from message_start with the output from message_delta", () => {
    const collector = createAnthropicUsageCollector();
    collector.observe({
      type: "message_start",
      message: {
        usage: {
          input_tokens: 210,
          output_tokens: 1,
          cache_read_input_tokens: 180,
          cache_creation_input_tokens: 24,
        },
      },
    });
    collector.observe({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } });
    collector.observe({ type: "message_delta", usage: { output_tokens: 57 } });

    expect(collector.result()).toEqual({
      input: 210,
      output: 57,
      cached: 180,
      cacheWrite: 24,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
    });
  });

  it("takes the latest cumulative value rather than summing restatements", () => {
    const collector = createAnthropicUsageCollector();
    collector.observe({ type: "message_delta", usage: { output_tokens: 10 } });
    collector.observe({ type: "message_delta", usage: { output_tokens: 25 } });
    expect(collector.result()?.output).toBe(25);
  });

  it("treats a null prompt-side restatement as 'not restated', not as an erasure", () => {
    const collector = createAnthropicUsageCollector();
    collector.observe({
      type: "message_start",
      message: { usage: { input_tokens: 99, cache_read_input_tokens: 40 } },
    });
    collector.observe({
      type: "message_delta",
      usage: { output_tokens: 5, input_tokens: null, cache_read_input_tokens: null },
    });

    const usage = collector.result();
    expect(usage?.input).toBe(99);
    expect(usage?.cached).toBe(40);
  });

  it("reports thinking tokens as reasoning", () => {
    const collector = createAnthropicUsageCollector();
    collector.observe({
      type: "message_delta",
      usage: { output_tokens: 300, output_tokens_details: { thinking_tokens: 240 } },
    });
    expect(collector.result()?.reasoning).toBe(240);
  });

  it("returns undefined when the stream carried no usage frame at all", () => {
    const collector = createAnthropicUsageCollector();
    collector.observe({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } });
    collector.observe({ type: "message_stop" });
    expect(collector.result()).toBeUndefined();
  });

  it("leaves uncached requests' cache counters undefined, never 0", () => {
    const collector = createAnthropicUsageCollector();
    collector.observe({
      type: "message_start",
      message: { usage: { input_tokens: 12, output_tokens: 0 } },
    });
    collector.observe({ type: "message_delta", usage: { output_tokens: 4 } });

    const usage = collector.result();
    expect(usage?.cached).toBeUndefined();
    expect(usage?.cacheWrite).toBeUndefined();
    expect(usage?.total).toBeUndefined();
  });
});

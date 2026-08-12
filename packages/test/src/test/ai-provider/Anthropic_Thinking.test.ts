/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/anthropic/ai";
import { describe, expect, it } from "vitest";

const { buildAnthropicThinkingParams, anthropicSupportsAdaptiveThinking } = _testOnly;

function model(opts: {
  model_name: string;
  effort?: string;
  thinking?: Record<string, unknown>;
  output_config?: Record<string, unknown>;
}) {
  return {
    provider: "ANTHROPIC",
    effort: opts.effort,
    provider_config: {
      model_name: opts.model_name,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
      ...(opts.output_config ? { output_config: opts.output_config } : {}),
    },
  } as never;
}

describe("anthropicSupportsAdaptiveThinking", () => {
  it("is true for Claude 4.6+ and 5.x", () => {
    expect(anthropicSupportsAdaptiveThinking(model({ model_name: "claude-sonnet-4-6" }))).toBe(
      true
    );
    expect(anthropicSupportsAdaptiveThinking(model({ model_name: "claude-sonnet-5" }))).toBe(true);
  });

  it("is false for Claude 4.5 and unrecognized ids", () => {
    expect(anthropicSupportsAdaptiveThinking(model({ model_name: "claude-haiku-4-5" }))).toBe(
      false
    );
    expect(anthropicSupportsAdaptiveThinking(model({ model_name: "not-a-claude" }))).toBe(false);
  });
});

describe("buildAnthropicThinkingParams", () => {
  it("omits thinking when effort is unset or none", () => {
    expect(buildAnthropicThinkingParams(model({ model_name: "claude-sonnet-5" }), 4096)).toEqual({
      max_tokens: 4096,
    });
    expect(
      buildAnthropicThinkingParams(model({ model_name: "claude-sonnet-5", effort: "none" }), 4096)
    ).toEqual({ max_tokens: 4096 });
  });

  it("maps high effort to adaptive on Claude 5", () => {
    expect(
      buildAnthropicThinkingParams(model({ model_name: "claude-sonnet-5", effort: "high" }), 1000)
    ).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      max_tokens: 1000 + 2048,
    });
  });

  it("maps high effort to budget_tokens on Claude 4.5", () => {
    expect(
      buildAnthropicThinkingParams(model({ model_name: "claude-haiku-4-5", effort: "high" }), 1000)
    ).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
      max_tokens: 1000 + 2048,
    });
  });

  it("maps extra/ultra onto adaptive xhigh/max", () => {
    expect(
      buildAnthropicThinkingParams(model({ model_name: "claude-opus-5", effort: "extra" }), 500)
        .output_config
    ).toEqual({ effort: "xhigh" });
    expect(
      buildAnthropicThinkingParams(model({ model_name: "claude-opus-5", effort: "ultra" }), 500)
        .output_config
    ).toEqual({ effort: "max" });
  });

  it("lets native provider_config.thinking win over effort", () => {
    expect(
      buildAnthropicThinkingParams(
        model({
          model_name: "claude-sonnet-5",
          effort: "ultra",
          thinking: { type: "enabled", budget_tokens: 100 },
        }),
        1000
      )
    ).toEqual({
      thinking: { type: "enabled", budget_tokens: 100 },
      max_tokens: 1100,
    });
  });

  it("lets native output_config.effort win over model.effort", () => {
    expect(
      buildAnthropicThinkingParams(
        model({
          model_name: "claude-sonnet-5",
          effort: "low",
          output_config: { effort: "max" },
        }),
        1000
      )
    ).toEqual({
      output_config: { effort: "max" },
      max_tokens: 1000,
    });
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { GOOGLE_GEMINI, _testOnly } from "@workglow/google-gemini/ai";
import { describe, expect, it } from "vitest";

const { resolveThinkingConfig } = _testOnly;

function model(extra: Record<string, unknown> = {}) {
  return {
    provider: GOOGLE_GEMINI,
    provider_config: { model_name: "gemini-3.8-flash" },
    ...extra,
  } as never;
}

describe("resolveThinkingConfig", () => {
  it("without defaultBudget leaves maxTokens unchanged when unset", () => {
    expect(resolveThinkingConfig(model(), 4096)).toEqual({
      thinkingConfig: undefined,
      maxOutputTokens: 4096,
    });
  });

  it("maps model.effort when thinking_budget unset", () => {
    expect(resolveThinkingConfig(model({ effort: "high" }), 1000)).toEqual({
      thinkingConfig: { thinkingBudget: 2048 },
      maxOutputTokens: 1000 + 2048,
    });
  });

  it("provider_config.thinking_budget wins over effort", () => {
    expect(
      resolveThinkingConfig(
        model({
          effort: "ultra",
          provider_config: { model_name: "gemini-3.8-flash", thinking_budget: 0 },
        }),
        1000
      )
    ).toEqual({
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 1000,
    });
  });

  it("maps none through ultra to the pinned budgets", () => {
    const expected: Record<string, number> = {
      none: 0,
      low: 512,
      medium: 1024,
      high: 2048,
      extra: 4096,
      ultra: 8192,
    };
    for (const [effort, budget] of Object.entries(expected)) {
      const result = resolveThinkingConfig(model({ effort }), 100);
      expect(result.thinkingConfig).toEqual({ thinkingBudget: budget });
      expect(result.maxOutputTokens).toBe(budget > 0 ? 100 + budget : 100);
    }
  });

  it("does not map model.effort on embedding or image models", () => {
    expect(
      resolveThinkingConfig(
        model({
          effort: "high",
          provider_config: { model_name: "gemini-embedding-001" },
        }),
        1000
      )
    ).toEqual({ thinkingConfig: undefined, maxOutputTokens: 1000 });
    expect(
      resolveThinkingConfig(
        model({
          effort: "ultra",
          provider_config: { model_name: "imagen-4.0-generate-001" },
        }),
        1000
      )
    ).toEqual({ thinkingConfig: undefined, maxOutputTokens: 1000 });
  });

  it("honours effort_options even when the class policy would allow the effort", () => {
    expect(resolveThinkingConfig(model({ effort: "high", effort_options: [] }), 1000)).toEqual({
      thinkingConfig: undefined,
      maxOutputTokens: 1000,
    });
  });
});

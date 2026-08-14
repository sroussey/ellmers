/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MODEL_EFFORTS } from "@workglow/ai";
import { ANTHROPIC, anthropicEffortPolicy } from "@workglow/anthropic/ai";
import { DEEPSEEK, deepseekEffortPolicy } from "@workglow/deepseek/ai";
import { geminiEffortPolicy, GOOGLE_GEMINI } from "@workglow/google-gemini/ai";
import { OPENROUTER, openrouterEffortPolicy } from "@workglow/openrouter/ai";
import { describe, expect, it } from "vitest";

function cfg(provider: string, model_name: string) {
  return { provider, provider_config: { model_name } };
}

describe("anthropicEffortPolicy", () => {
  it("returns all levels with no default when the name is empty", () => {
    expect(anthropicEffortPolicy(cfg(ANTHROPIC, ""))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: undefined,
    });
  });

  it("treats parsed Claude ids as all six with default none", () => {
    expect(anthropicEffortPolicy(cfg(ANTHROPIC, "claude-sonnet-5"))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: "none",
    });
  });

  it("returns no levels for a non-Claude id", () => {
    expect(anthropicEffortPolicy(cfg(ANTHROPIC, "not-claude"))?.supported).toEqual([]);
  });
});

describe("geminiEffortPolicy", () => {
  it("returns all levels with no default when the name is empty", () => {
    expect(geminiEffortPolicy(cfg(GOOGLE_GEMINI, ""))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: undefined,
    });
  });

  it("treats text gemini models as all six with default none", () => {
    expect(geminiEffortPolicy(cfg(GOOGLE_GEMINI, "gemini-3.5-flash"))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: "none",
    });
  });

  it("returns no levels for embeddings and image models", () => {
    expect(geminiEffortPolicy(cfg(GOOGLE_GEMINI, "gemini-embedding-2"))?.supported).toEqual([]);
    expect(geminiEffortPolicy(cfg(GOOGLE_GEMINI, "imagen-4.0-generate-001"))?.supported).toEqual(
      []
    );
    expect(geminiEffortPolicy(cfg(GOOGLE_GEMINI, "gemini-3.1-flash-image"))?.supported).toEqual([]);
  });
});

describe("deepseekEffortPolicy", () => {
  it("returns all levels with no default when the name is empty", () => {
    expect(deepseekEffortPolicy(cfg(DEEPSEEK, ""))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: undefined,
    });
  });

  it("treats deepseek-v4 as all six with default high", () => {
    expect(deepseekEffortPolicy(cfg(DEEPSEEK, "deepseek-v4-flash"))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: "high",
    });
  });

  it("returns no levels for other DeepSeek ids", () => {
    expect(deepseekEffortPolicy(cfg(DEEPSEEK, "deepseek-chat"))?.supported).toEqual([]);
  });
});

describe("openrouterEffortPolicy", () => {
  it("returns all levels with no default for empty and named ids", () => {
    expect(openrouterEffortPolicy(cfg(OPENROUTER, ""))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: undefined,
    });
    expect(openrouterEffortPolicy(cfg(OPENROUTER, "openai/gpt-5"))).toEqual({
      supported: [...MODEL_EFFORTS],
      default: undefined,
    });
  });
});

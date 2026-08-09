/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly as anthropicTestOnly } from "@workglow/anthropic/ai";
import { describe, expect, it } from "vitest";

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

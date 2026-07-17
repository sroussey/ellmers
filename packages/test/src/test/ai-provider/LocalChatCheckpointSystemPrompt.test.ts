/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { resolveHftCheckpointSystemPrompt } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_Chat";
import { resolveLlamaCppCheckpointSystemPrompt } from "../../../../../providers/node-llama-cpp/src/ai/common/LlamaCpp_Chat";

describe("checkpoint-seeded local chat system prompts", () => {
  it("HuggingFace Transformers prefers the caller prompt and inherits the checkpoint prompt", () => {
    expect(resolveHftCheckpointSystemPrompt("caller system", "checkpoint system")).toBe(
      "caller system"
    );
    expect(resolveHftCheckpointSystemPrompt(undefined, "checkpoint system")).toBe(
      "checkpoint system"
    );
  });

  it("node-llama-cpp prefers the caller prompt and inherits the checkpoint prompt", () => {
    expect(resolveLlamaCppCheckpointSystemPrompt("caller system", "checkpoint system")).toBe(
      "caller system"
    );
    expect(resolveLlamaCppCheckpointSystemPrompt(undefined, "checkpoint system")).toBe(
      "checkpoint system"
    );
  });
});

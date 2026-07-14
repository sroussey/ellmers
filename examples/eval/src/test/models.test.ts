/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseModelList, resolveModelConfig } from "../models";

describe("resolveModelConfig", () => {
  it("routes cloud ids to their provider by shape", () => {
    expect(resolveModelConfig("claude-haiku-4-5", "classify").provider).toBe("ANTHROPIC");
    expect(resolveModelConfig("gpt-5.5", "classify").provider).toBe("OPENAI");
    expect(resolveModelConfig("o3-mini", "classify").provider).toBe("OPENAI");
    expect(resolveModelConfig("text-embedding-3-small", "similarity").provider).toBe("OPENAI");
    expect(resolveModelConfig("gemini-3-flash-preview", "classify").provider).toBe("GOOGLE_GEMINI");
    expect(resolveModelConfig("grok-4.5", "classify").provider).toBe("XAI");
  });

  it("passes the id through as the provider model name", () => {
    const config = resolveModelConfig("claude-haiku-4-5", "classify");
    expect(config.provider_config.model_name).toBe("claude-haiku-4-5");
  });

  it("routes org/name paths to local HuggingFace ONNX with a kind-specific pipeline", () => {
    const embed = resolveModelConfig("Xenova/all-MiniLM-L6-v2", "similarity");
    expect(embed.provider).toBe("HF_TRANSFORMERS_ONNX");
    expect(embed.provider_config.pipeline).toBe("feature-extraction");
    expect(embed.provider_config.dtype).toBe("q8");

    const generate = resolveModelConfig("HuggingFaceTB/SmolLM2-360M-Instruct", "classify");
    expect(generate.provider_config.pipeline).toBe("text-generation");
    expect(generate.provider_config.dtype).toBe("q4");
  });

  it("honors a :dtype suffix on local model paths", () => {
    const config = resolveModelConfig("onnx-community/Qwen3-0.6B-ONNX:fp16", "classify");
    expect(config.provider_config.model_path).toBe("onnx-community/Qwen3-0.6B-ONNX");
    expect(config.provider_config.dtype).toBe("fp16");
  });

  it("rejects ids with no recognizable shape", () => {
    expect(() => resolveModelConfig("mystery-model", "classify")).toThrow(/cannot infer/);
  });
});

describe("parseModelList", () => {
  it("trims, drops empties, and de-duplicates", () => {
    expect(parseModelList(" a, b ,,a ,c")).toEqual(["a", "b", "c"]);
  });
});

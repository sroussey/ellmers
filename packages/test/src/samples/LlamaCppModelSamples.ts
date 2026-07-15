/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGlobalModelRepository } from "@workglow/ai";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai";
import { LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai";

/**
 * Registers local GGUF (node-llama-cpp) model records. Metadata only — weights
 * must be downloaded before generation via ModelDownloadTask (`model_url`),
 * which stores them in the provider's cache layout under its models dir and
 * remembers the resolved location worker-side; `model_path` is the fallback
 * location generation tries when no download resolution exists.
 *
 * The Bonsai 27B family (released 2026-07, Qwen3.6-27B base) currently ships
 * GGUF, MLX, and AWQ conversions only; `onnx-community` ONNX conversions stop
 * at the 8B sizes as of 2026-07. Add the ONNX 27B record alongside these once
 * `onnx-community/Bonsai-27B-ONNX` is published.
 */
export async function registerLlamaCppLocalModels(): Promise<void> {
  const ggufModels: LlamaCppModelRecord[] = [
    {
      model_id: "gguf:prism-ml/Bonsai-27B-gguf:Q1_0",
      title: "Bonsai 27B (1-bit GGUF)",
      description: "prism-ml/Bonsai-27B-gguf Q1_0 — 1-bit Bonsai 27B, Qwen3.6-27B base",
      capabilities: ["text.generation", "json-mode"],
      provider: LOCAL_LLAMACPP,
      provider_config: {
        model_path: "./models/Bonsai-27B-Q1_0.gguf",
        model_url: "hf:prism-ml/Bonsai-27B-gguf:Q1_0",
      },
      metadata: {},
    },
    {
      model_id: "gguf:prism-ml/Ternary-Bonsai-27B-gguf:Q2_0",
      title: "Ternary Bonsai 27B (2-bit GGUF)",
      description: "prism-ml/Ternary-Bonsai-27B-gguf Q2_0 — ternary Bonsai 27B, Qwen3.6-27B base",
      capabilities: ["text.generation", "json-mode"],
      provider: LOCAL_LLAMACPP,
      provider_config: {
        model_path: "./models/Ternary-Bonsai-27B-Q2_0.gguf",
        model_url: "hf:prism-ml/Ternary-Bonsai-27B-gguf:Q2_0",
      },
      metadata: {},
    },
  ];

  for (const model of ggufModels) {
    await getGlobalModelRepository().addModel(model);
  }
}

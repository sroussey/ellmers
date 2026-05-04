/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
} from "@workglow/ai/worker";
import { HF_INFERENCE } from "./common/HFI_Constants";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

/**
 * AI provider for Hugging Face Inference API.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the Hugging Face Inference API using the `@huggingface/inference` SDK.
 *
 * Task run functions are injected via the constructor so that the `@huggingface/inference` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 */
export class HfInferenceProvider extends AiProvider<HfInferenceModelConfig> {
  readonly name = HF_INFERENCE;
  readonly displayName = "Hugging Face Inference";
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "ModelInfoTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfInferenceModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, HfInferenceModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

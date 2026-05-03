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
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

/**
 * AI provider for Google Gemini cloud models.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the Google Generative AI API using the `@google/generative-ai` SDK.
 *
 * Task run functions are injected via the constructor so that the SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 */
export class GoogleGeminiProvider extends AiProvider<GeminiModelConfig> {
  readonly name = GOOGLE_GEMINI;
  readonly displayName = "Google Gemini";
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "CountTokensTask",
    "ModelInfoTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
    "ModelSearchTask",
    "ImageGenerateTask",
    "ImageEditTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, GeminiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, GeminiModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, GeminiModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

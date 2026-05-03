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
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

/**
 * AI provider for OpenAI cloud models.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the OpenAI API using the `openai` SDK.
 *
 * Task run functions are injected via the constructor so that the `openai` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 */
export class OpenAiProvider extends AiProvider<OpenAiModelConfig> {
  readonly name = OPENAI;
  readonly displayName = "OpenAI";
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "CountTokensTask",
    "ModelInfoTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, OpenAiModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, OpenAiModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

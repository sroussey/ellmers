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
import { ANTHROPIC } from "./common/Anthropic_Constants";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

/**
 * AI provider for Anthropic cloud models.
 *
 * Supports text generation, text rewriting, and text summarization via the
 * Anthropic Messages API using the `@anthropic-ai/sdk` SDK.
 *
 * Note: Anthropic does not offer an embeddings API, so TextEmbeddingTask
 * is not supported by this provider.
 *
 * Task run functions are injected via the constructor so that the SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 */
export class AnthropicProvider extends AiProvider<AnthropicModelConfig> {
  readonly name = ANTHROPIC;
  readonly displayName = "Anthropic";
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "CountTokensTask",
    "ModelInfoTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, AnthropicModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, AnthropicModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

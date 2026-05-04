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
import { OLLAMA } from "./common/Ollama_Constants";
import type { OllamaModelConfig } from "./common/Ollama_ModelSchema";

/**
 * AI provider for Ollama local LLM server.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the Ollama API using the `ollama` SDK.
 *
 * Ollama runs locally and does not require an API key -- only a `base_url`
 * (defaults to `http://localhost:11434`).
 *
 * Task run functions are injected via the constructor so that the `ollama` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 */
export class OllamaProvider extends AiProvider<OllamaModelConfig> {
  readonly name = OLLAMA;
  readonly displayName = "Ollama";
  readonly isLocal = true;
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
    tasks?: Record<string, AiProviderRunFn<any, any, OllamaModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, OllamaModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, OllamaModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

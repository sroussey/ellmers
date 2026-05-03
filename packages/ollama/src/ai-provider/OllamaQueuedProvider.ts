/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import { OLLAMA } from "./common/Ollama_Constants";
import type { OllamaModelConfig } from "./common/Ollama_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class OllamaQueuedProvider extends AiProvider<OllamaModelConfig> {
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

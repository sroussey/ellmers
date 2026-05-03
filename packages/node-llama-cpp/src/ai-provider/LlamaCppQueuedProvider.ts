/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueuedAiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { ModelConfig } from "@workglow/ai";
import { LOCAL_LLAMACPP } from "./common/LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./common/LlamaCpp_ModelSchema";
import { deleteLlamaCppSession } from "./common/LlamaCpp_Runtime";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class LlamaCppQueuedProvider extends QueuedAiProvider<LlamaCppModelConfig> {
  readonly name = LOCAL_LLAMACPP;
  readonly displayName = "Local llama.cpp";
  readonly isLocal = true;
  readonly supportsBrowser = false;

  readonly taskTypes = [
    "DownloadModelTask",
    "UnloadModelTask",
    "ModelInfoTask",
    "CountTokensTask",
    "AiChatTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, LlamaCppModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, LlamaCppModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, LlamaCppModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }

  override createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  override async disposeSession(sessionId: string): Promise<void> {
    deleteLlamaCppSession(sessionId);
  }
}

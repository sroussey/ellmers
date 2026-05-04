/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class OpenAiQueuedProvider extends AiProvider<OpenAiModelConfig> {
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
    "ImageGenerateTask",
    "ImageEditTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, OpenAiModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, OpenAiModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class GoogleGeminiQueuedProvider extends AiProvider<GeminiModelConfig> {
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

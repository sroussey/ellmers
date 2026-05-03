/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import { ANTHROPIC } from "./common/Anthropic_Constants";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class AnthropicQueuedProvider extends AiProvider<AnthropicModelConfig> {
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

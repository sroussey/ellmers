/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import { HF_INFERENCE } from "./common/HFI_Constants";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class HfInferenceQueuedProvider extends AiProvider<HfInferenceModelConfig> {
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
    "ImageGenerateTask",
    "ImageEditTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfInferenceModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, HfInferenceModelConfig>>
  ) {
    super(tasks, streamTasks, previewTasks);
  }
}

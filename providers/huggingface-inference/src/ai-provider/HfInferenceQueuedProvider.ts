/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai-provider/common";
import { HF_INFERENCE } from "./common/HFI_Constants";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

const HFI_QUEUED_TASK_TYPES = [
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

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class HfInferenceQueuedProvider extends createCloudProviderClass<
  HfInferenceModelConfig,
  typeof HFI_QUEUED_TASK_TYPES
>(AiProvider, {
  name: HF_INFERENCE,
  displayName: "Hugging Face Inference",
  taskTypes: HFI_QUEUED_TASK_TYPES,
}) {}

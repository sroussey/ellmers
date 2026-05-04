/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import { createCloudProviderClass } from "@workglow/ai-provider/common";
import { HF_INFERENCE } from "./common/HFI_Constants";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

const HFI_WORKER_TASK_TYPES = [
  "ModelInfoTask",
  "TextGenerationTask",
  "TextEmbeddingTask",
  "TextRewriterTask",
  "TextSummaryTask",
  "ToolCallingTask",
  "ModelSearchTask",
] as const;

/**
 * Worker-server registration for Hugging Face Inference. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 */
export class HfInferenceProvider extends createCloudProviderClass<
  HfInferenceModelConfig,
  typeof HFI_WORKER_TASK_TYPES
>(AiProvider, {
  name: HF_INFERENCE,
  displayName: "Hugging Face Inference",
  taskTypes: HFI_WORKER_TASK_TYPES,
}) {}

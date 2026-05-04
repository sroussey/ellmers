/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import { createCloudProviderClass } from "@workglow/ai-provider/common";
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

const OPENAI_WORKER_TASK_TYPES = [
  "TextGenerationTask",
  "TextEmbeddingTask",
  "TextRewriterTask",
  "TextSummaryTask",
  "CountTokensTask",
  "ModelInfoTask",
  "StructuredGenerationTask",
  "ToolCallingTask",
  "ModelSearchTask",
] as const;

/**
 * Worker-server registration for OpenAI cloud models. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded in the worker.
 */
export class OpenAiProvider extends createCloudProviderClass<
  OpenAiModelConfig,
  typeof OPENAI_WORKER_TASK_TYPES
>(AiProvider, {
  name: OPENAI,
  displayName: "OpenAI",
  taskTypes: OPENAI_WORKER_TASK_TYPES,
}) {}

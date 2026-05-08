/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

const OPENAI_QUEUED_TASK_TYPES = [
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

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class OpenAiQueuedProvider extends createCloudProviderClass<
  OpenAiModelConfig,
  typeof OPENAI_QUEUED_TASK_TYPES
>(AiProvider, {
  name: OPENAI,
  displayName: "OpenAI",
  taskTypes: OPENAI_QUEUED_TASK_TYPES,
}) {}

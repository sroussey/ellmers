/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

const GEMINI_TASK_TYPES = [
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

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class GoogleGeminiQueuedProvider extends createCloudProviderClass<
  GeminiModelConfig,
  typeof GEMINI_TASK_TYPES
>(AiProvider, {
  name: GOOGLE_GEMINI,
  displayName: "Google Gemini",
  taskTypes: GEMINI_TASK_TYPES,
}) {}

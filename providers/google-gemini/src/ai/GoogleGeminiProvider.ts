/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
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

/**
 * Worker-server registration for Google Gemini cloud models. Imports
 * `AiProvider` from `@workglow/ai/worker` so the SDK is only loaded in the
 * worker.
 */
export class GoogleGeminiProvider extends createCloudProviderClass<
  GeminiModelConfig,
  typeof GEMINI_TASK_TYPES
>(AiProvider, {
  name: GOOGLE_GEMINI,
  displayName: "Google Gemini",
  taskTypes: GEMINI_TASK_TYPES,
}) {}

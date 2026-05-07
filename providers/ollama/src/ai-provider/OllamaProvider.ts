/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import { createCloudProviderClass } from "@workglow/ai-provider/common";
import { OLLAMA } from "./common/Ollama_Constants";
import type { OllamaModelConfig } from "./common/Ollama_ModelSchema";

const OLLAMA_TASK_TYPES = [
  "ModelInfoTask",
  "TextGenerationTask",
  "TextEmbeddingTask",
  "TextRewriterTask",
  "TextSummaryTask",
  "ToolCallingTask",
  "ModelSearchTask",
] as const;

/**
 * Worker-server registration for Ollama. Imports `AiProvider` from
 * `@workglow/ai/worker` so the SDK is only loaded in the worker.
 *
 * Ollama runs locally and does not require an API key — only a `base_url`
 * (defaults to `http://localhost:11434`).
 */
export class OllamaProvider extends createCloudProviderClass<
  OllamaModelConfig,
  typeof OLLAMA_TASK_TYPES
>(AiProvider, {
  name: OLLAMA,
  displayName: "Ollama",
  isLocal: true,
  taskTypes: OLLAMA_TASK_TYPES,
}) {}

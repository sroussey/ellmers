/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
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

/** Main-thread registration (inline or worker-backed). No queue — uses direct execution. */
export class OllamaQueuedProvider extends createCloudProviderClass<
  OllamaModelConfig,
  typeof OLLAMA_TASK_TYPES
>(AiProvider, {
  name: OLLAMA,
  displayName: "Ollama",
  isLocal: true,
  taskTypes: OLLAMA_TASK_TYPES,
}) {}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider } from "@workglow/ai/worker";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import { ANTHROPIC } from "./common/Anthropic_Constants";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

const ANTHROPIC_TASK_TYPES = [
  "CountTokensTask",
  "ModelInfoTask",
  "TextGenerationTask",
  "TextRewriterTask",
  "TextSummaryTask",
  "StructuredGenerationTask",
  "ToolCallingTask",
  "ModelSearchTask",
] as const;

/**
 * Worker-server registration for Anthropic cloud models. Imports `AiProvider`
 * from `@workglow/ai/worker` so the SDK is only loaded where actually needed.
 *
 * Note: Anthropic does not offer an embeddings API.
 */
export class AnthropicProvider extends createCloudProviderClass<
  AnthropicModelConfig,
  typeof ANTHROPIC_TASK_TYPES
>(AiProvider, {
  name: ANTHROPIC,
  displayName: "Anthropic",
  taskTypes: ANTHROPIC_TASK_TYPES,
}) {}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationTaskInput } from "@workglow/ai";
import { isModelEffort, toOpenAIMessages, type ModelEffort } from "@workglow/ai/worker";
import type { OpenRouterProviderConfig } from "./OpenRouter_Client";
import { getModelName } from "./OpenRouter_Client";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";

/** Maps coarse {@link ModelEffort} onto OpenRouter's `reasoning` extras. */
function mapEffortToOpenRouterReasoning(effort: ModelEffort): Record<string, unknown> {
  if (effort === "none") return { effort: "none", exclude: true };
  const mapped = effort === "extra" ? "xhigh" : effort === "ultra" ? "max" : effort;
  return { effort: mapped };
}

interface UnifiedTextGenerationInput extends TextGenerationTaskInput {
  readonly messages?: readonly unknown[];
  readonly systemPrompt?: string;
}

/**
 * Assemble the base OpenAI-shaped chat params — preferring a populated
 * `messages` array (AiChatTask), falling back to wrapping `prompt` as a single
 * user message (TextGenerationTask).
 */
export function buildChatParams(
  input: UnifiedTextGenerationInput,
  model: OpenRouterModelConfig | undefined
): Record<string, unknown> {
  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;
  const messages = hasMessages
    ? toOpenAIMessages({
        messages: input.messages,
        systemPrompt: input.systemPrompt,
        prompt: "",
        tools: [],
      } as never)
    : [{ role: "user" as const, content: input.prompt }];

  const params: Record<string, unknown> = {
    model: getModelName(model),
    messages,
  };
  if (input.maxTokens !== undefined) params.max_completion_tokens = input.maxTokens;
  if (input.temperature !== undefined) params.temperature = input.temperature;
  if ((input as { topP?: number }).topP !== undefined)
    params.top_p = (input as { topP?: number }).topP;
  if ((input as { frequencyPenalty?: number }).frequencyPenalty !== undefined)
    params.frequency_penalty = (input as { frequencyPenalty?: number }).frequencyPenalty;
  if ((input as { presencePenalty?: number }).presencePenalty !== undefined)
    params.presence_penalty = (input as { presencePenalty?: number }).presencePenalty;
  return params;
}

/**
 * Assemble OpenRouter-native request extras: routing preferences (`provider`),
 * `reasoning` (native `provider_config.reasoning` wins over `model.effort`),
 * and the web-search `plugins` entry.
 */
export function buildOpenRouterExtras(
  model: OpenRouterModelConfig | undefined
): Record<string, unknown> {
  const pc = model?.provider_config as OpenRouterProviderConfig | undefined;
  const extras: Record<string, unknown> = {};
  if (pc?.provider_routing) extras.provider = pc.provider_routing;
  if (pc?.reasoning) extras.reasoning = pc.reasoning;
  else if (isModelEffort(model?.effort)) {
    extras.reasoning = mapEffortToOpenRouterReasoning(model.effort);
  }
  if (pc?.web_search) {
    extras.plugins = [pc.web_search === true ? { id: "web" } : { id: "web", ...pc.web_search }];
  }
  return extras;
}

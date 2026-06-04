/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCallingTaskInput, ToolCalls } from "@workglow/ai";
import {
  adaptParserResult,
  parseHermes,
  parseLiquid,
  parseLlama,
  parseQwen35Xml,
} from "@workglow/ai/provider-utils";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";

export function getModelTextCandidates(model: LlamaCppModelConfig): string[] {
  return [
    model.model_id,
    model.title,
    model.description,
    model.provider_config.model_url,
    model.provider_config.model_path,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
}

/**
 * Whether the text likely contains tool call markup worth parsing.
 */
export function hasToolCallMarkers(text: string): boolean {
  return (
    text.includes("<tool_call>") ||
    text.includes("<start_function_call>") ||
    text.includes("<|tool_call_start|>") ||
    /\[\w+\(/.test(text)
  );
}

export function detectQwenToolCallingVariation(
  model: LlamaCppModelConfig
): "3" | "3.5" | undefined {
  const candidates = getModelTextCandidates(model);

  if (
    candidates.some((value) =>
      /\bqwen(?:[\s._-]?|)3(?:[\s._-]?|)5\b|\bqwen(?:[\s._-]?|)3\.5\b/.test(value)
    )
  ) {
    return "3.5";
  }

  if (candidates.some((value) => /\bqwen(?:[\s._-]?|)3\b/.test(value))) {
    return "3";
  }

  return undefined;
}

export function extractToolCallsFromText(text: string, input: ToolCallingTaskInput): ToolCalls {
  // Try Liquid/LFM format: <|tool_call_start|>[func(args)]<|tool_call_end|> or [func(args)]
  const liquidResult = parseLiquid(text);
  if (liquidResult && liquidResult.tool_calls.length > 0) {
    return adaptParserResult(liquidResult, input).toolCalls;
  }

  // Try Hermes/JSON format: <tool_call>{"name":...}</tool_call>
  const hermesResult = parseHermes(text);
  if (hermesResult && hermesResult.tool_calls.length > 0) {
    return adaptParserResult(hermesResult, input).toolCalls;
  }

  // Try Qwen 3.5 XML format: <tool_call><function=name><parameter=...></tool_call>
  const qwen35Result = parseQwen35Xml(text);
  if (qwen35Result && qwen35Result.tool_calls.length > 0) {
    return adaptParserResult(qwen35Result, input).toolCalls;
  }

  // Try Llama/bare JSON format: {"name": "func", "parameters"|"arguments": {...}}
  const llamaResult = parseLlama(text);
  if (llamaResult && llamaResult.tool_calls.length > 0) {
    return adaptParserResult(llamaResult, input).toolCalls;
  }

  return [];
}

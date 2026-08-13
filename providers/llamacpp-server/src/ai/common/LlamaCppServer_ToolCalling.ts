/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
  Usage,
} from "@workglow/ai";
import {
  createEstimatedOutputUsageReporter,
  localOnlyFetch,
  mapOpenAIChatUsage,
  OPENAI_STREAM_USAGE_OPTIONS,
} from "@workglow/ai/provider-utils";
import {
  buildToolDescription,
  filterValidToolCalls,
  sanitizeToolArgs,
  toTextFlatMessages,
} from "@workglow/ai/worker";
import { parsePartialJson } from "@workglow/util/worker";
import {
  acquireBaseUrl,
  buildServerUrl,
  readChatCompletionDeltas,
  type ILlamaCppServerProviderOptions,
} from "./LlamaCppServer_Client";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";
import { getLlamaCppServerModelName } from "./LlamaCppServer_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

function mapTools(tools: readonly ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as unknown,
    },
  }));
}

export function createLlamaCppServerToolCallingStream(
  opts: ILlamaCppServerProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<ToolCallingTaskInput, ToolCallingTaskOutput, LlamaCppServerModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    const messages = toTextFlatMessages(input);
    const tools = input.toolChoice === "none" ? undefined : mapTools(input.tools);
    const body = JSON.stringify({
      model: getLlamaCppServerModelName(model),
      messages,
      ...(tools ? { tools } : {}),
      stream: true,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      ...OPENAI_STREAM_USAGE_OPTIONS,
    });
    const { baseUrl, release } = await acquire(model, opts);
    try {
      const provisionalUsage = createEstimatedOutputUsageReporter(emit);
      provisionalUsage.onPrompt(
        messages
          .map((m) => (typeof m.content === "string" ? m.content : ""))
          .filter(Boolean)
          .join("\n")
      );

      const response = await localOnlyFetch(
        buildServerUrl(baseUrl, "/v1/chat/completions"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal,
        },
        "LlamaCppServer"
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "(no body)");
        throw new Error(
          `LlamaCppServer: HTTP ${response.status} from /v1/chat/completions (tool-use) — ${text}`
        );
      }

      let accumulatedText = "";
      const accumulatedArgs = new Map<number, string>();
      const callMeta = new Map<number, { id?: string; name?: string }>();
      let nextSyntheticIndex = 0;
      let lastEmittedToolCalls: ToolCalls = [];
      let usage: Usage | undefined;

      for await (const delta of readChatCompletionDeltas(response, signal)) {
        if (delta.done) break;
        usage = mapOpenAIChatUsage(delta.usage) ?? usage;
        if (delta.contentDelta) {
          accumulatedText += delta.contentDelta;
          provisionalUsage.onText(delta.contentDelta);
          emit({ type: "text-delta", port: "text", textDelta: delta.contentDelta });
        }
        if (delta.toolCallDeltas?.length) {
          for (const tc of delta.toolCallDeltas) {
            const idx = typeof tc.index === "number" ? tc.index : nextSyntheticIndex++;
            const meta = callMeta.get(idx) ?? {};
            if (tc.id) meta.id = tc.id;
            if (tc.function?.name) meta.name = tc.function.name;
            callMeta.set(idx, meta);
            if (tc.function?.arguments) {
              provisionalUsage.onText(tc.function.arguments);
              accumulatedArgs.set(idx, (accumulatedArgs.get(idx) ?? "") + tc.function.arguments);
            }
          }
          lastEmittedToolCalls = buildToolCalls(accumulatedArgs, callMeta);
          emit({ type: "object-delta", port: "toolCalls", objectDelta: [...lastEmittedToolCalls] });
        }
      }
      provisionalUsage.flush();
      const finalToolCalls = filterValidToolCalls(lastEmittedToolCalls, input.tools);
      emit({
        type: "finish",
        data: { text: accumulatedText, toolCalls: finalToolCalls } as ToolCallingTaskOutput,
        usage,
      });
    } finally {
      await release();
    }
  };
}

function buildToolCalls(
  argsByIndex: Map<number, string>,
  metaByIndex: Map<number, { id?: string; name?: string }>
): ToolCalls {
  const result: ToolCalls = [];
  const indices = [...argsByIndex.keys(), ...metaByIndex.keys()];
  const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
  for (const idx of unique) {
    const meta = metaByIndex.get(idx) ?? {};
    if (!meta.name) continue;
    const raw = argsByIndex.get(idx) ?? "";
    let parsed: Record<string, unknown> = {};
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        const partial = parsePartialJson(raw);
        parsed = (partial as Record<string, unknown>) ?? {};
      }
    }
    result.push({
      id: meta.id ?? `call_${idx}`,
      name: meta.name,
      input: sanitizeToolArgs(parsed) as Record<string, unknown>,
    });
  }
  return result;
}

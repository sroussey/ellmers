/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildToolDescription, filterValidToolCalls } from "@workglow/ai/worker";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export type OllamaToolCallingMessagesFn = (
  input: ToolCallingTaskInput
) => Array<{ role: string; content: string }>;

function mapOllamaTools(tools: ReadonlyArray<ToolDefinition>) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));
}

export function createOllamaToolCalling(
  getClient: GetClient,
  buildMessages: OllamaToolCallingMessagesFn
): AiProviderRunFn<ToolCallingTaskInput, ToolCallingTaskOutput, OllamaModelConfig> {
  const run: AiProviderRunFn<
    ToolCallingTaskInput,
    ToolCallingTaskOutput,
    OllamaModelConfig
  > = async (input, model, update_progress, _signal) => {
    update_progress(0, "Starting Ollama tool calling");
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const messages = buildMessages(input);

    const tools = input.toolChoice === "none" ? undefined : mapOllamaTools(input.tools);

    const response = await client.chat({
      model: modelName,
      messages,
      tools,
      options: {
        temperature: input.temperature,
        num_predict: input.maxTokens,
      },
    });

    const text = response.message.content ?? "";
    const toolCalls: ToolCalls = [];
    (response.message.tool_calls ?? []).forEach((tc: any, index: number) => {
      let parsedInput: Record<string, unknown> = {};
      const fnArgs = tc.function.arguments;
      if (typeof fnArgs === "string") {
        try {
          parsedInput = JSON.parse(fnArgs);
        } catch {
          const partial = parsePartialJson(fnArgs);
          parsedInput = (partial as Record<string, unknown>) ?? {};
        }
      } else if (fnArgs != null) {
        parsedInput = fnArgs as Record<string, unknown>;
      }
      const id = `call_${index}`;
      toolCalls.push({ id, name: tc.function.name as string, input: parsedInput });
    });

    update_progress(100, "Completed Ollama tool calling");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  };
  return run;
}

export function createOllamaToolCallingStream(
  getClient: GetClient,
  buildMessages: OllamaToolCallingMessagesFn
): AiProviderStreamFn<ToolCallingTaskInput, ToolCallingTaskOutput, OllamaModelConfig> {
  return async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    const messages = buildMessages(input);

    const tools = input.toolChoice === "none" ? undefined : mapOllamaTools(input.tools);

    const stream = await client.chat({
      model: modelName,
      messages,
      tools,
      options: {
        temperature: input.temperature,
        num_predict: input.maxTokens,
      },
      stream: true,
    });

    const onAbort = () => stream.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    let accumulatedText = "";
    const toolCalls: ToolCalls = [];
    let callIndex = 0;

    try {
      for await (const chunk of stream) {
        const delta = chunk.message.content;
        if (delta) {
          accumulatedText += delta;
          yield { type: "text-delta", port: "text", textDelta: delta };
        }

        const chunkToolCalls = chunk.message.tool_calls;
        if (Array.isArray(chunkToolCalls) && chunkToolCalls.length > 0) {
          for (const tc of chunkToolCalls) {
            let parsedInput: Record<string, unknown> = {};
            const fnArgs = tc.function.arguments;
            if (typeof fnArgs === "string") {
              try {
                parsedInput = JSON.parse(fnArgs);
              } catch {
                const partial = parsePartialJson(fnArgs);
                parsedInput = (partial as Record<string, unknown>) ?? {};
              }
            } else if (fnArgs != null) {
              parsedInput = fnArgs as Record<string, unknown>;
            }
            const id = `call_${callIndex++}`;
            toolCalls.push({ id, name: tc.function.name as string, input: parsedInput });
          }
          yield { type: "object-delta", port: "toolCalls", objectDelta: [...toolCalls] };
        }
      }

      const validToolCalls = filterValidToolCalls(toolCalls, input.tools);
      yield {
        type: "finish",
        data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}

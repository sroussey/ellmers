/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildToolDescription, filterValidToolCalls, toOpenAIMessages } from "@workglow/ai/worker";
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
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

function mapOpenAIToolChoice(
  toolChoice: string | undefined
): "auto" | "none" | "required" | { type: "function"; function: { name: string } } | undefined {
  if (!toolChoice || toolChoice === "auto") return "auto";
  if (toolChoice === "none") return "none";
  if (toolChoice === "required") return "required";
  return { type: "function", function: { name: toolChoice } };
}

export const OpenAI_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input) as any[];

  const toolChoice = mapOpenAIToolChoice(input.toolChoice);

  const params: any = {
    model: modelName,
    messages,
    max_completion_tokens: input.maxTokens,
    temperature: input.temperature,
  };

  params.tools = tools;
  params.tool_choice = toolChoice;

  const response = await client.chat.completions.create(params, { signal });

  const text = response.choices[0]?.message?.content ?? "";
  const toolCalls: ToolCalls = [];
  for (const tc of response.choices[0]?.message?.tool_calls ?? []) {
    if (!("function" in tc)) continue;
    const id = tc.id as string;
    const name = tc.function.name as string;
    let inputArgs: Record<string, unknown> = {};
    const rawArgs = tc.function.arguments;
    if (typeof rawArgs === "string") {
      try {
        inputArgs = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        try {
          const partial = parsePartialJson(rawArgs);
          if (partial && typeof partial === "object") {
            inputArgs = partial as Record<string, unknown>;
          }
        } catch {
          inputArgs = {};
        }
      }
    }
    toolCalls.push({ id, name, input: inputArgs });
  }

  update_progress(100, "Completed OpenAI tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const OpenAI_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input) as any[];

  const toolChoice = mapOpenAIToolChoice(input.toolChoice);
  const toolOptions = toolChoice === undefined ? {} : { tools, tool_choice: toolChoice };

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
      ...toolOptions,
    },
    { signal }
  );

  const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const contentDelta = choice.delta?.content ?? "";
    if (contentDelta) {
      yield { type: "text-delta", port: "text", textDelta: contentDelta };
    }

    const tcDeltas = (choice.delta as any)?.tool_calls;
    if (Array.isArray(tcDeltas)) {
      for (const tcDelta of tcDeltas) {
        const idx = tcDelta.index as number;
        if (!toolCallAccumulator.has(idx)) {
          toolCallAccumulator.set(idx, {
            id: tcDelta.id ?? "",
            name: tcDelta.function?.name ?? "",
            arguments: "",
          });
        }
        const acc = toolCallAccumulator.get(idx)!;
        if (tcDelta.id) acc.id = tcDelta.id;
        if (tcDelta.function?.name) acc.name = tcDelta.function.name;
        if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;

        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(acc.arguments);
        } catch {
          const partial = parsePartialJson(acc.arguments);
          parsedInput = (partial as Record<string, unknown>) ?? {};
        }
        yield {
          type: "object-delta",
          port: "toolCalls",
          objectDelta: [{ id: acc.id, name: acc.name, input: parsedInput }],
        };
      }
    }
  }

  yield { type: "finish", data: { text: "", toolCalls: [] } as ToolCallingTaskOutput };
};

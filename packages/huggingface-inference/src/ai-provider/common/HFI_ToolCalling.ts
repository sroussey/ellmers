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
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName, getProvider } from "./HFI_Client";

function mapHFIToolChoice(
  toolChoice: string | undefined
): "auto" | "none" | "required" | undefined {
  if (!toolChoice || toolChoice === "auto") return "auto";
  if (toolChoice === "none") return "none";
  if (toolChoice === "required") return "required";
  return "auto";
}

export const HFI_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting HF Inference tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input);

  const toolChoice = mapHFIToolChoice(input.toolChoice);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    provider,
  };

  if (toolChoice !== "none") {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const response = await client.chatCompletion(params, { signal });

  const text = response.choices[0]?.message?.content ?? "";
  const toolCalls: ToolCalls = [];
  let callIndex = 0;
  ((response.choices[0]?.message as any)?.tool_calls ?? []).forEach((tc: any) => {
    let parsedInput: Record<string, unknown> = {};
    const rawArgs = tc.function?.arguments;
    if (typeof rawArgs === "string") {
      try {
        parsedInput = JSON.parse(rawArgs);
      } catch {
        const partial = parsePartialJson(rawArgs);
        parsedInput = (partial as Record<string, unknown>) ?? {};
      }
    } else if (rawArgs != null) {
      parsedInput = rawArgs as Record<string, unknown>;
    }
    const id = (tc.id as string) ?? `call_${callIndex}`;
    callIndex++;
    toolCalls.push({ id, name: tc.function.name as string, input: parsedInput });
  });

  update_progress(100, "Completed HF Inference tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const HFI_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input);

  const toolChoice = mapHFIToolChoice(input.toolChoice);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    provider,
  };

  if (toolChoice !== "none") {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const stream = client.chatCompletionStream(params, { signal });

  let accumulatedText = "";
  const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const contentDelta = choice.delta?.content ?? "";
    if (contentDelta) {
      accumulatedText += contentDelta;
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
      }

      const snapshot: ToolCalls = [];
      for (const [, tc] of toolCallAccumulator) {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(tc.arguments);
        } catch {
          const partial = parsePartialJson(tc.arguments);
          parsedInput = (partial as Record<string, unknown>) ?? {};
        }
        snapshot.push({ id: tc.id, name: tc.name, input: parsedInput });
      }
      yield { type: "object-delta", port: "toolCalls", objectDelta: snapshot };
    }
  }

  const toolCalls: ToolCalls = [];
  for (const [, tc] of toolCallAccumulator) {
    let finalInput: Record<string, unknown>;
    try {
      finalInput = JSON.parse(tc.arguments);
    } catch {
      finalInput = (parsePartialJson(tc.arguments) as Record<string, unknown>) ?? {};
    }
    toolCalls.push({ id: tc.id, name: tc.name, input: finalInput });
  }

  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);
  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};

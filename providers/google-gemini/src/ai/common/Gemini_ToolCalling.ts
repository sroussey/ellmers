/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FunctionCallingMode } from "@google/generative-ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai/worker";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ChatMessage,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";
import { sanitizeSchemaForGemini } from "./Gemini_Schema";

export function buildGeminiContents(
  messages: ReadonlyArray<ChatMessage> | undefined,
  prompt: unknown
): any[] {
  if (!messages || messages.length === 0) {
    return [{ role: "user", parts: [{ text: prompt }] }];
  }

  // Index tool_use ids → names from any prior assistant turn (Gemini wants
  // the function name on the functionResponse, not just the id).
  const toolUseNames = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        toolUseNames.set(block.id, block.name);
      }
    }
  }

  const contents: any[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const parts: any[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "image") {
          parts.push({ inlineData: { mimeType: block.mimeType, data: block.data } });
        }
      }
      contents.push({ role: "user", parts });
    } else if (msg.role === "assistant") {
      const parts: any[] = [];
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({ functionCall: { name: block.name, args: block.input } });
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      const parts: any[] = [];
      for (const block of msg.content) {
        if (block.type !== "tool_result") continue;
        const name = toolUseNames.get(block.tool_use_id) ?? "unknown";
        const textContent = block.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join("");
        let response: Record<string, unknown>;
        try {
          response = JSON.parse(textContent);
        } catch {
          response = { result: textContent };
        }
        parts.push({ functionResponse: { name, response } });
      }
      if (parts.length > 0) contents.push({ role: "user", parts });
    }
  }
  return contents;
}

function mapGeminiToolConfig(
  toolChoice: string | undefined
):
  | { functionCallingConfig: { mode: FunctionCallingMode; allowedFunctionNames?: string[] } }
  | undefined {
  if (!toolChoice || toolChoice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" as FunctionCallingMode } };
  }
  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: "NONE" as FunctionCallingMode } };
  }
  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: "ANY" as FunctionCallingMode } };
  }
  return {
    functionCallingConfig: {
      mode: "ANY" as FunctionCallingMode,
      allowedFunctionNames: [toolChoice],
    },
  };
}

export const Gemini_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Gemini tool calling");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));

  const functionDeclarations = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    parameters: sanitizeSchemaForGemini(t.inputSchema as Record<string, unknown>) as any,
  }));

  const toolConfig = mapGeminiToolConfig(input.toolChoice);

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    tools: [{ functionDeclarations }],
    toolConfig: toolConfig as any,
    systemInstruction: input.systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const contents = buildGeminiContents(input.messages, input.prompt);

  const result = await genModel.generateContent({ contents });

  const parts = result.response.candidates?.[0]?.content?.parts ?? [];

  const textParts: string[] = [];
  const toolCalls: ToolCalls = [];
  let callIndex = 0;

  for (const part of parts) {
    if ("text" in part && part.text) {
      textParts.push(part.text);
    }
    if ("functionCall" in part && part.functionCall) {
      const id = `call_${callIndex++}`;
      toolCalls.push({
        id,
        name: part.functionCall.name,
        input: (part.functionCall.args as Record<string, unknown>) ?? {},
      });
    }
  }

  update_progress(100, "Completed Gemini tool calling");
  return { text: textParts.join(""), toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const Gemini_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));

  const functionDeclarations = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    parameters: sanitizeSchemaForGemini(t.inputSchema as Record<string, unknown>) as any,
  }));

  const toolConfig = mapGeminiToolConfig(input.toolChoice);

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    tools: [{ functionDeclarations }],
    toolConfig: toolConfig as any,
    systemInstruction: input.systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const contents = buildGeminiContents(input.messages, input.prompt);

  const result = await genModel.generateContentStream({ contents }, { signal });

  let callIndex = 0;

  for await (const chunk of result.stream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if ("text" in part && part.text) {
        yield { type: "text-delta", port: "text", textDelta: part.text };
      }
      if ("functionCall" in part && part.functionCall) {
        const id = `call_${callIndex++}`;
        yield {
          type: "object-delta",
          port: "toolCalls",
          objectDelta: [
            {
              id,
              name: part.functionCall.name,
              input: (part.functionCall.args as Record<string, unknown>) ?? {},
            },
          ],
        };
      }
    }
  }

  yield { type: "finish", data: { text: "", toolCalls: [] } as ToolCallingTaskOutput };
};

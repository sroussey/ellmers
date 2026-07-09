/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionCallingConfigMode } from "@google/genai";
import type {
  AiProviderRunFn,
  ChatMessage,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls, sanitizeToolArgs } from "@workglow/ai/worker";
import { createGeminiClient, getModelName, getThinkingBudget } from "./Gemini_Client";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
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
          // Thinking models (Gemini 2.5+/3.x) return an opaque `thoughtSignature`
          // alongside each functionCall part. It MUST be echoed back verbatim on
          // the same part in later turns or the API rejects the request with
          // "Function call is missing a thought_signature".
          const part: Record<string, unknown> = {
            functionCall: { name: block.name, args: block.input },
          };
          if (block.providerSignature) {
            part.thoughtSignature = block.providerSignature;
          }
          parts.push(part);
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
  | { functionCallingConfig: { mode: FunctionCallingConfigMode; allowedFunctionNames?: string[] } }
  | undefined {
  if (!toolChoice || toolChoice === "auto") {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } };
  }
  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } };
  }
  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } };
  }
  return {
    functionCallingConfig: {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [toolChoice],
    },
  };
}

export const Gemini_ToolCalling_Stream: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  GeminiModelConfig
> = async (input, model, signal, emit) => {
  const ai = await createGeminiClient(model);

  const functionDeclarations = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    parameters: sanitizeSchemaForGemini(t.inputSchema as Record<string, unknown>) as any,
  }));

  const toolConfig = mapGeminiToolConfig(input.toolChoice);

  const contents = buildGeminiContents(input.messages, input.prompt);

  const thinkingBudget = getThinkingBudget(model);

  const result = await ai.models.generateContentStream({
    model: getModelName(model),
    contents,
    config: {
      abortSignal: signal ?? undefined,
      systemInstruction: input.systemPrompt || undefined,
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      tools: [{ functionDeclarations }],
      toolConfig: toolConfig as any,
      ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
    },
  });

  let callIndex = 0;

  for await (const chunk of result) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text && !part.thought) {
        emit({ type: "text-delta", port: "text", textDelta: part.text });
      }
      if (part.functionCall) {
        const id = `call_${callIndex++}`;
        // Defence-in-depth: drop tool calls whose name isn't in the
        // declared tool set before emitting. Gemini's tool API respects
        // `input.tools` but a stray response that hallucinates a function
        // name would otherwise propagate to dispatch.
        const validated = filterValidToolCalls(
          [
            {
              id,
              name: part.functionCall.name ?? "",
              input: sanitizeToolArgs(
                (part.functionCall.args as Record<string, unknown>) ?? {}
              ) as Record<string, unknown>,
              // Carry the opaque thinking-model signature so the consumer can
              // replay it on the next turn (see buildGeminiContents).
              ...(part.thoughtSignature ? { providerSignature: part.thoughtSignature } : {}),
            },
          ],
          input.tools
        );
        if (validated.length > 0) {
          emit({
            type: "object-delta",
            port: "toolCalls",
            objectDelta: validated,
          });
        }
      }
    }
  }

  emit({ type: "finish", data: { text: "", toolCalls: [] } as ToolCallingTaskOutput });
};

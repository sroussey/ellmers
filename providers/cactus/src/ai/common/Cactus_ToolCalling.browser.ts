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
} from "@workglow/ai";
import { extractMessageText } from "@workglow/ai/provider-utils";
import { filterValidToolCalls } from "@workglow/ai/worker";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { needleStreamPiece, parseNeedleToolCalls } from "./Cactus_ParseToolCalls";
import { getOrLoadEngine } from "./Cactus_Runtime.browser";

function buildToolsJson(tools: ReadonlyArray<ToolDefinition>): string {
  return JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.inputSchema ? { parameters: t.inputSchema } : {}),
    }))
  );
}

function promptText(input: ToolCallingTaskInput): string {
  if (typeof input.prompt === "string") return input.prompt;
  if (input.prompt) return extractMessageText(input.prompt);
  if (input.messages && input.messages.length > 0) {
    const last = input.messages[input.messages.length - 1];
    return extractMessageText(last.content);
  }
  return "";
}

export const Cactus_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  CactusModelConfig
> = async (input, model, signal, emit) => {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");
  if (signal.aborted) throw signal.reason ?? new Error("The operation was aborted");

  const engine = await getOrLoadEngine(model);
  const query = promptText(input);
  const toolsJson = buildToolsJson(input.tools);

  let raw = "";
  const engineWithStream = engine as unknown as {
    run_stream?: (
      q: string,
      t: string,
      cb: (tokenIdOrChunk: number | string, piece?: string) => void
    ) => Promise<string> | string;
    run_json?: (q: string, t: string) => Promise<string> | string;
    run: (q: string, t: string) => Promise<string> | string;
  };

  if (typeof engineWithStream.run_stream === "function") {
    raw = await engineWithStream.run_stream(query, toolsJson, (tokenIdOrChunk, piece) => {
      emit({
        type: "text-delta",
        port: "text",
        textDelta: needleStreamPiece(tokenIdOrChunk, piece),
      });
    });
  } else if (typeof engineWithStream.run_json === "function") {
    const out = await engineWithStream.run(query, toolsJson);
    raw = typeof out === "string" ? out : String(out);
  } else {
    const out = await engineWithStream.run(query, toolsJson);
    raw = typeof out === "string" ? out : String(out);
  }

  const parsed: ToolCalls = parseNeedleToolCalls(raw);
  const validToolCalls = filterValidToolCalls(parsed, input.tools);
  if (validToolCalls.length > 0) {
    emit({ type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] });
  }
  emit({ type: "finish", data: { text: raw, toolCalls: validToolCalls } });
};

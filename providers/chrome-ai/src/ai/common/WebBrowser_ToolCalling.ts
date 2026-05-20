/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ChatMessage,
  ToolCall,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai";

import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

function messageText(msg: ChatMessage): string {
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function flattenPrompt(prompt: ToolCallingTaskInput["prompt"]): string {
  if (typeof prompt === "string") return prompt;
  if (!Array.isArray(prompt)) return "";
  return prompt
    .map((p) => {
      if (typeof p === "string") return p;
      const b = p as { type?: string; text?: string };
      return b.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * Build `initialPrompts` + the trailing prompt text from a {@link ToolCallingTaskInput}.
 *
 * When `input.messages` is present we treat the last user message as the
 * turn-in-progress; everything before it goes into `initialPrompts`. tool
 * messages and non-text content blocks are dropped — Chrome's open-web Prompt
 * API surface is system/user/assistant + text/image/audio, and our base64
 * ContentBlock images aren't wired up yet. Multi-turn tool-calling histories
 * (assistant tool_use + tool role tool_result) collapse to text-only frames,
 * so a follow-up turn after tool execution may lose structured tool-call
 * context. The orchestrator is responsible for re-supplying any context the
 * model needs as plain text.
 */
function buildToolCallPrompt(input: ToolCallingTaskInput): {
  initialPrompts: LanguageModelCreateOptions["initialPrompts"];
  promptText: string;
} {
  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;
  if (hasMessages) {
    const messages = input.messages as readonly ChatMessage[];
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) {
      return { initialPrompts: [], promptText: flattenPrompt(input.prompt) };
    }

    const history = messages.slice(0, lastUserIdx);
    const tail: LanguageModelMessage[] = [];
    let leadingSystem: LanguageModelSystemMessage | undefined;
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const text = messageText(msg);
      if (text.length === 0) continue;
      if (msg.role === "system") {
        if (i === 0 && leadingSystem === undefined) {
          leadingSystem = { role: "system", content: text };
        }
        continue;
      }
      if (msg.role === "user" || msg.role === "assistant") {
        tail.push({ role: msg.role, content: text });
      }
    }
    const initialPrompts: LanguageModelCreateOptions["initialPrompts"] = leadingSystem
      ? [leadingSystem, ...tail]
      : tail;
    return { initialPrompts, promptText: messageText(messages[lastUserIdx]) };
  }

  const initialPrompts: LanguageModelCreateOptions["initialPrompts"] = input.systemPrompt
    ? [{ role: "system", content: input.systemPrompt }]
    : [];
  return { initialPrompts, promptText: flattenPrompt(input.prompt) };
}

/**
 * Streaming run-fn for `["text.generation", "tool-use"]`.
 *
 * Chrome's Prompt API runs the tool-calling loop **inside** `prompt()`: the
 * model decides to invoke a tool, Chrome calls the tool's `execute(args)`
 * callback, awaits the returned string, and feeds that string back into the
 * model as the tool result. To bridge into workglow's protocol — where the
 * task graph executes tools externally and the run-fn returns the requested
 * calls — we install stub tools whose `execute` captures the args, returns
 * an empty placeholder, and lets Chrome's loop continue. The model may make
 * multiple calls and generate text either before, between, or after them;
 * everything is captured, then emitted at the end.
 *
 * **Trade-off**: text generated *after* a tool call is reasoning over our
 * empty placeholder rather than real tool output, so it's likely junk. The
 * orchestrator's next turn (with real tool results re-fed via `messages`)
 * is what produces the useful follow-up text — this turn's role is to
 * extract the tool intent, not to converse.
 */
export const WebBrowser_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit) => {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  const capturedCalls: ToolCall[] = [];

  // `toolChoice: "none"` → omit tools entirely so the model can't call any.
  // Specific tool-name choices aren't expressible in Chrome's surface; we
  // pass all tools and let the model decide.
  const chromeTools: LanguageModelTool[] =
    input.toolChoice === "none"
      ? []
      : input.tools.map((td) => ({
          name: td.name,
          description: buildToolDescription(td),
          inputSchema: td.inputSchema as object,
          execute: async (...args: unknown[]): Promise<string> => {
            const callInput = (args[0] ?? {}) as Record<string, unknown>;
            capturedCalls.push({
              id: crypto.randomUUID(),
              name: td.name,
              input: callInput,
            });
            return "";
          },
        }));

  const { initialPrompts, promptText } = buildToolCallPrompt(input);

  const session = await factory.create({
    signal,
    temperature: input.temperature ?? undefined,
    tools: chromeTools.length > 0 ? chromeTools : undefined,
    initialPrompts,
    monitor: createDownloadMonitor(emit),
  });

  try {
    const stream = session.promptStreaming(promptText, { signal });
    // Forward text-delta and snapshot events; swallow the inner `finish`
    // because we need to emit a composite finish below (text + toolCalls).
    for await (const e of snapshotStreamToTextDeltas<ToolCallingTaskOutput>(
      stream,
      "text",
      (text) => ({ text, toolCalls: [] })
    )) {
      if (e.type === "finish") continue;
      emit(e);
    }

    // Defence in depth against hallucinated tool names — same shape as
    // OpenAI/Anthropic tool-calling run-fns.
    const validated = filterValidToolCalls(capturedCalls, input.tools);
    if (validated.length > 0) {
      emit({ type: "object-delta", port: "toolCalls", objectDelta: validated });
    }
    emit({ type: "finish", data: {} as ToolCallingTaskOutput });
  } finally {
    session.destroy();
  }
};

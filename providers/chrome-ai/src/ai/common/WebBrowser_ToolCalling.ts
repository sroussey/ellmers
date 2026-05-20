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
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai";
import { uuid4 } from "@workglow/util";

import {
  buildInitialPromptsFromHistory,
  findLastUserIndex,
  messageText,
} from "./WebBrowser_ChatHistory";
import {
  createDownloadMonitor,
  ensureAvailable,
  getApi,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  deleteChromeSession,
  dropChromeSessionEntry,
  getChromeSession,
  setChromeSession,
} from "./WebBrowser_Sessions";

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
 * turn-in-progress; everything before it goes into `initialPrompts` via
 * {@link buildInitialPromptsFromHistory}. Multi-turn tool-calling histories
 * (assistant tool_use + tool role tool_result) collapse to text-only frames,
 * so a follow-up turn after tool execution may lose structured tool-call
 * context. The orchestrator is responsible for re-supplying any context the
 * model needs as plain text.
 */
function buildToolCallPrompt(input: ToolCallingTaskInput): {
  initialPrompts: LanguageModelCreateOptions["initialPrompts"];
  promptText: string;
  priorMessageCount: number;
} {
  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;
  if (hasMessages) {
    const messages = input.messages as readonly ChatMessage[];
    const lastUserIdx = findLastUserIndex(messages);
    if (lastUserIdx < 0) {
      return {
        initialPrompts: [],
        promptText: flattenPrompt(input.prompt),
        priorMessageCount: messages.length,
      };
    }
    return {
      initialPrompts: buildInitialPromptsFromHistory(messages.slice(0, lastUserIdx)),
      promptText: messageText(messages[lastUserIdx]),
      priorMessageCount: lastUserIdx,
    };
  }

  const initialPrompts: LanguageModelCreateOptions["initialPrompts"] = input.systemPrompt
    ? [{ role: "system", content: input.systemPrompt }]
    : [];
  return { initialPrompts, promptText: flattenPrompt(input.prompt), priorMessageCount: 0 };
}

/**
 * Stable fingerprint of the tool set bound at `create()` time. Tool sets
 * are compared by sorted name list — Chrome can't hot-swap tools per turn,
 * so any change to the set invalidates a cached session. We intentionally
 * don't include each tool's `inputSchema` here: if the *names* match,
 * reuse; a schema-only edit on a same-named tool is unusual enough that
 * the modest correctness risk is preferable to the cache thrash of hashing
 * full schemas every turn.
 */
function toolsFingerprint(tools: readonly ToolDefinition[]): string {
  return tools
    .map((t) => t.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .sort()
    .join(",");
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
 *
 * `temperature` is `@deprecated` for non-extension contexts in the current
 * Chrome spec and silently ignored on the open web. Passed through anyway
 * so extension callers still get the knob.
 *
 * ## Session reuse
 *
 * When `sessionId` is provided and `input.messages` is present we *may*
 * cache the underlying `LanguageModel`. There's a real correctness risk
 * here: Chrome's tool-calling loop appends tool-result turns to the
 * session's internal state opaquely. Reusing the cached session across
 * orchestrator turns would double-feed those results once the orchestrator
 * also re-supplies them via `messages`. To stay safe:
 *  - We only cache when the orchestrator is driving via `input.messages`.
 *  - Cache reuse requires that the tool set hasn't changed.
 *  - On any error we drop and destroy the cache entry — Chrome's internal
 *    state may be in the middle of a tool-call cycle.
 */
export const WebBrowser_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  WebBrowserModelConfig
> = async (input, _model, signal, emit, _outputSchema, sessionId) => {
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
            // If the user aborted mid-loop, short-circuit without capturing
            // — the surrounding `promptStreaming` will throw on its next
            // read and the finally below will tear down the session.
            if (signal?.aborted) return "";
            const callInput = (args[0] ?? {}) as Record<string, unknown>;
            capturedCalls.push({ id: uuid4(), name: td.name, input: callInput });
            return "";
          },
        }));

  const { initialPrompts, promptText, priorMessageCount } = buildToolCallPrompt(input);
  const fingerprint = toolsFingerprint(input.tools);

  // Safety guard: only allow cache reuse when the orchestrator drives via
  // `input.messages`. In the bare-prompt path Chrome's session may carry
  // opaque tool-call state from a prior turn that we can't reason about.
  const cacheable = sessionId !== undefined && Array.isArray(input.messages);

  let cached = cacheable && sessionId ? getChromeSession(sessionId) : undefined;
  if (
    cacheable &&
    sessionId &&
    cached &&
    (cached.messageCount !== priorMessageCount || cached.toolsFingerprint !== fingerprint)
  ) {
    deleteChromeSession(sessionId);
    cached = undefined;
  }

  const usedCachedSession = cached !== undefined;
  let session: LanguageModel;
  if (cached) {
    session = cached.session;
  } else {
    session = await factory.create({
      signal,
      temperature: input.temperature ?? undefined,
      tools: chromeTools.length > 0 ? chromeTools : undefined,
      initialPrompts,
      monitor: createDownloadMonitor(emit),
    });
  }

  let cacheWritten = false;
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
    if (cacheable && sessionId !== undefined) {
      // Watermark post-turn count: prior history + 1 trailing user turn +
      // 1 assistant turn. Matches WebBrowser_Chat's convention.
      setChromeSession(sessionId, {
        session,
        messageCount: priorMessageCount + 2,
        toolsFingerprint: fingerprint,
      });
      cacheWritten = true;
    }
    emit({ type: "finish", data: {} as ToolCallingTaskOutput });
  } finally {
    if (!cacheWritten) {
      if (cacheable && sessionId !== undefined && usedCachedSession) {
        dropChromeSessionEntry(sessionId, session);
      }
      try {
        session.destroy();
      } catch {
        // best-effort
      }
    }
  }
};

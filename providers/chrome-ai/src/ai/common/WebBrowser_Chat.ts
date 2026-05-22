/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiEmit,
  AiProviderRunFn,
  ChatMessage,
} from "@workglow/ai";
import { LANGUAGE_MODEL_AVAILABILITY_OPTIONS } from "./WebBrowser_ApiBinding";
import { assertAvailability, getApi, snapshotStreamToTextDeltas } from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";
import {
  disposeWebBrowserSession,
  getWebBrowserModelKey,
  getWebBrowserSession,
  setWebBrowserSession,
  touchWebBrowserSession,
} from "./WebBrowser_Sessions";

interface PromptSession {
  promptStreaming(prompt: string, options: { signal: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface PromptFactory {
  availability(options?: unknown): Promise<unknown>;
  create(options?: unknown): Promise<PromptSession>;
}

function languageModelFactory(): PromptFactory | undefined {
  const globals = globalThis as typeof globalThis & {
    LanguageModel?: PromptFactory;
    ai?: { languageModel?: PromptFactory };
  };
  return globals.LanguageModel ?? globals.ai?.languageModel;
}

function textFromMessage(message: ChatMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("");
}

function latestUserText(messages: ReadonlyArray<ChatMessage>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    const text = textFromMessage(messages[i]);
    if (text.length > 0) return text;
  }
  return "";
}

function recentHistory(messages: ReadonlyArray<ChatMessage>): string {
  const previous = messages.slice(0, -1).slice(-8);
  if (previous.length === 0) return "";
  return previous
    .map((message) => `${message.role.toUpperCase()}: ${textFromMessage(message)}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

function promptFallback(input: AiChatProviderInput): string {
  if (typeof input.prompt === "string") return input.prompt;
  return input.prompt
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("");
}

function buildPrompt(input: AiChatProviderInput): string {
  const messages = input.messages ?? [];
  const history = recentHistory(messages);
  const userText = latestUserText(messages) || promptFallback(input);
  const parts = [
    input.systemPrompt ? `SYSTEM AND CONTEXT:\n${input.systemPrompt}` : "",
    history ? `RECENT HISTORY:\n${history}` : "",
    `USER:\n${userText}`,
  ];
  return parts.filter((part) => part.length > 0).join("\n\n");
}

function isDestroyedSessionError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "InvalidStateError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /session has been destroyed|session.*destroyed/i.test(message);
}

async function createPromptSession(): Promise<PromptSession> {
  const factory = getApi("LanguageModel", languageModelFactory());
  assertAvailability(
    "LanguageModel",
    (await factory.availability(LANGUAGE_MODEL_AVAILABILITY_OPTIONS)) as never
  );
  return (await factory.create({})) as PromptSession;
}

async function getOrCreateSession(
  sessionId: string | undefined,
  model: WebBrowserModelConfig | undefined
): Promise<{ session: PromptSession; shouldDestroyOnComplete: boolean }> {
  if (sessionId) {
    const existing = getWebBrowserSession(sessionId);
    if (existing)
      return { session: existing.session as PromptSession, shouldDestroyOnComplete: false };
  }

  const session = await createPromptSession();
  if (!sessionId) return { session, shouldDestroyOnComplete: true };

  setWebBrowserSession(sessionId, {
    modelKey: getWebBrowserModelKey(model),
    session,
  });
  return { session, shouldDestroyOnComplete: false };
}

async function runPrompt(
  input: AiChatProviderInput,
  model: WebBrowserModelConfig | undefined,
  signal: AbortSignal,
  emit: AiEmit<AiChatProviderOutput>,
  sessionId: string | undefined
): Promise<void> {
  const { session, shouldDestroyOnComplete } = await getOrCreateSession(sessionId, model);
  try {
    const stream = session.promptStreaming(buildPrompt(input), { signal });
    for await (const event of snapshotStreamToTextDeltas<AiChatProviderOutput>(
      stream,
      "text",
      (text) => ({ text })
    )) {
      emit(event);
    }
    if (sessionId) touchWebBrowserSession(sessionId);
  } finally {
    if (shouldDestroyOnComplete) {
      session.destroy();
    }
  }
}

export const WebBrowser_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  WebBrowserModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionId) => {
  try {
    await runPrompt(input, model, signal, emit, sessionId);
  } catch (error) {
    if (!sessionId || signal.aborted || !isDestroyedSessionError(error)) {
      throw error;
    }
    await disposeWebBrowserSession(sessionId);
    await runPrompt(input, model, signal, emit, sessionId);
  }
};

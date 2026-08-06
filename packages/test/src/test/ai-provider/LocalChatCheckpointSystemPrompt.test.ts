/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiChatProviderInput, AiSessionContext, ChatMessage } from "@workglow/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HFT_Chat,
  resolveHftCheckpointSystemPrompt,
} from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_Chat";
import {
  getPipelineCacheKey,
  pipelines,
} from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_Pipeline";
import {
  LlamaCpp_Chat_Stream,
  resolveLlamaCppCheckpointSystemPrompt,
} from "../../../../../providers/node-llama-cpp/src/ai/common/LlamaCpp_Chat";
import * as llamaRuntime from "../../../../../providers/node-llama-cpp/src/ai/common/LlamaCpp_Runtime";

const userMessage = (text: string): ChatMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

const checkpointSession: AiSessionContext = {
  sessionId: "owned-chat",
  ownedSession: true,
  prefix: {
    systemPrompt: "checkpoint system",
    messages: [userMessage("checkpoint question")],
  },
};

afterEach(() => {
  pipelines.clear();
  llamaRuntime.llamaCppSessions.clear();
  vi.restoreAllMocks();
});

describe("checkpoint-seeded local chat system prompts", () => {
  it("HuggingFace Transformers prefers the caller prompt and inherits the checkpoint prompt", () => {
    expect(resolveHftCheckpointSystemPrompt("caller system", "checkpoint system")).toBe(
      "caller system"
    );
    expect(resolveHftCheckpointSystemPrompt(undefined, "checkpoint system")).toBe(
      "checkpoint system"
    );
  });

  it("node-llama-cpp prefers the caller prompt and inherits the checkpoint prompt", () => {
    expect(resolveLlamaCppCheckpointSystemPrompt("caller system", "checkpoint system")).toBe(
      "caller system"
    );
    expect(resolveLlamaCppCheckpointSystemPrompt(undefined, "checkpoint system")).toBe(
      "checkpoint system"
    );
  });

  it("renders the caller system prompt in the HFT checkpoint chat branch", async () => {
    const model = {
      provider_config: {
        model_path: "test-model",
        pipeline: "text-generation",
      },
    } as never;
    const templateCalls: Array<{
      readonly messages: Array<Record<string, unknown>>;
      readonly options: { readonly add_generation_prompt: boolean };
    }> = [];
    const tokenizer = Object.assign((_prompt: string) => ({ input_ids: { dims: [1, 1] } }), {
      all_special_ids: [],
      apply_chat_template: (
        messages: Array<Record<string, unknown>>,
        options: { readonly add_generation_prompt: boolean }
      ) => {
        templateCalls.push({ messages, options });
        return options.add_generation_prompt ? "full-chat" : "checkpoint-prefix";
      },
      decode: () => "",
    });
    const generate = vi.fn(async () => ({ dims: [1, 1] }));
    pipelines.set(getPipelineCacheKey(model), {
      tokenizer,
      model: { generate },
    } as never);

    await HFT_Chat(
      {
        messages: [userMessage("new question")],
        systemPrompt: "caller system",
      } as unknown as AiChatProviderInput,
      model,
      new AbortController().signal,
      () => undefined,
      undefined,
      checkpointSession
    );

    const chatRender = templateCalls.find((call) => call.options.add_generation_prompt);
    expect(chatRender?.messages[0]).toEqual({
      role: "system",
      content: "caller system",
    });
    expect(chatRender?.messages).not.toContainEqual({
      role: "system",
      content: "checkpoint system",
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("bakes the caller prompt into a new owned Llama session and reuses it next turn", async () => {
    const constructorOptions = vi.fn();
    const historyCalls: Array<Array<Record<string, unknown>>> = [];
    const prompt = vi.fn(
      async (_text: string, options: { onTextChunk: (text: string) => void }) => {
        options.onTextChunk("reply");
      }
    );
    const dispose = vi.fn(async () => undefined);
    class FakeLlamaChatSession {
      constructor(options: unknown) {
        constructorOptions(options);
      }

      setChatHistory(history: Array<Record<string, unknown>>): void {
        historyCalls.push(structuredClone(history));
      }

      async preloadPrompt(): Promise<void> {}

      prompt = prompt;
      dispose = dispose;
    }
    const sequence = { dispose: vi.fn(async () => undefined) };
    vi.spyOn(llamaRuntime, "loadSdk").mockResolvedValue({
      LlamaChatSession: FakeLlamaChatSession,
    } as never);
    vi.spyOn(llamaRuntime, "getOrCreateTextContext").mockResolvedValue({} as never);
    vi.spyOn(llamaRuntime, "acquireContextSequence").mockResolvedValue(sequence as never);

    const model = {
      provider_config: { model_path: "test-model.gguf" },
    } as never;
    const emit = vi.fn();
    await LlamaCpp_Chat_Stream(
      {
        messages: [userMessage("first question")],
        systemPrompt: "caller system",
      } as unknown as AiChatProviderInput,
      model,
      new AbortController().signal,
      emit,
      undefined,
      checkpointSession
    );
    await LlamaCpp_Chat_Stream(
      {
        messages: [userMessage("first question"), userMessage("follow-up")],
        systemPrompt: "caller system",
      } as unknown as AiChatProviderInput,
      model,
      new AbortController().signal,
      emit,
      undefined,
      checkpointSession
    );

    expect(constructorOptions).toHaveBeenCalledOnce();
    expect(constructorOptions).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "caller system" })
    );
    // setChatHistory replaces the constructor-baked history wholesale, so the
    // rebuild history itself must carry the CALLER's system prompt (not the
    // checkpoint's) alongside the checkpoint prefix's conversation.
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0][0]).toEqual({ type: "system", text: "caller system" });
    expect(historyCalls[0]).toContainEqual({ type: "user", text: "checkpoint question" });
    expect(historyCalls[0]).not.toContainEqual({ type: "system", text: "checkpoint system" });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls.map(([text]) => text)).toEqual(["first question", "follow-up"]);
    expect(llamaRuntime.llamaCppSessions.get("owned-chat")?.mode).toBe("progressive");
    expect(dispose).not.toHaveBeenCalled();
    expect(sequence.dispose).not.toHaveBeenCalled();
  });
});

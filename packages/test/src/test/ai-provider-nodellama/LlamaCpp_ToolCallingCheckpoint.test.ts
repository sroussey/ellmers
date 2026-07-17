/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiSessionContext,
  CheckpointPrefix,
  ToolCallingTaskInput,
} from "@workglow/ai";
import {
  accumulatingEmit,
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "@workglow/ai";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai";
import { LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai";
import {
  deleteLlamaCppSession,
  llamaCppSessions,
  llamaCppTextContexts,
  registerLlamaCppInline,
  releaseLlamaCppTransientSessions,
} from "@workglow/node-llama-cpp/ai-runtime";
import type { TaskOutput } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdkState = {
  failure: undefined as "chat-constructor" | "generate-sync" | "preload" | undefined,
  chatDisposeCount: 0,
  sessionDisposeCount: 0,
  chatSequences: [] as unknown[],
  generatedHistories: [] as any[][],
  preloadPrompts: [] as string[],
  sessionHistories: [] as any[][],
};

vi.mock("node-llama-cpp", () => ({
  LlamaChat: class {
    readonly sequence: unknown;
    private disposed = false;

    constructor(options: { readonly contextSequence: unknown }) {
      if (sdkState.failure === "chat-constructor") {
        throw new Error("chat constructor failed");
      }
      this.sequence = options.contextSequence;
      sdkState.chatSequences.push(this.sequence);
    }

    generateResponse(
      history: any[],
      options: {
        readonly onTextChunk: (chunk: string) => void;
        readonly signal: AbortSignal;
      }
    ): Promise<{
      readonly response: string;
      readonly functionCalls: ReadonlyArray<{
        readonly functionName: string;
        readonly params: Record<string, unknown>;
      }>;
      readonly lastEvaluation: { readonly cleanHistory: any[] };
    }> {
      sdkState.generatedHistories.push(structuredClone(history));
      if (sdkState.failure === "generate-sync") {
        throw new Error("generation failed synchronously");
      }
      if (options.signal.aborted) {
        return Promise.reject(options.signal.reason);
      }
      options.onTextChunk("calling");
      const cleanHistory = [
        ...history,
        {
          type: "model",
          response: [
            "calling",
            {
              type: "functionCall",
              name: "lookup",
              description: "Look up a query",
              params: { query: "weather" },
            },
          ],
        },
      ];
      return Promise.resolve({
        response: "calling",
        functionCalls: [{ functionName: "lookup", params: { query: "weather" } }],
        lastEvaluation: { cleanHistory },
      });
    }

    async dispose(): Promise<void> {
      if (this.disposed) return;
      this.disposed = true;
      sdkState.chatDisposeCount += 1;
    }
  },
  LlamaChatSession: class {
    private history: any[];
    private disposed = false;

    constructor(options: { readonly contextSequence: unknown; readonly systemPrompt?: string }) {
      this.history =
        options.systemPrompt === undefined ? [] : [{ type: "system", text: options.systemPrompt }];
    }

    async preloadPrompt(prompt: string): Promise<void> {
      sdkState.preloadPrompts.push(prompt);
      if (sdkState.failure === "preload") {
        throw new Error("preload failed");
      }
    }

    getChatHistory(): any[] {
      return structuredClone(this.history);
    }

    setChatHistory(history: any[]): void {
      this.history = structuredClone(history);
      sdkState.sessionHistories.push(structuredClone(history));
    }

    async dispose(): Promise<void> {
      if (this.disposed) return;
      this.disposed = true;
      sdkState.sessionDisposeCount += 1;
    }
  },
}));

const model: LlamaCppModelRecord = {
  model_id: "llamacpp:test-tool-checkpoint",
  title: "Test tool checkpoint model",
  description: "Provider-level checkpoint lifecycle fixture",
  capabilities: ["text.generation", "tool-use", "cache.checkpoint"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "/tmp/test-tool-checkpoint.gguf",
  },
  metadata: {},
};

const tool = {
  name: "lookup",
  description: "Look up a query",
  inputSchema: {
    type: "object" as const,
    properties: { query: { type: "string" as const } },
    required: ["query"],
  },
};

const prefix: CheckpointPrefix = {
  systemPrompt: "Use the lookup tool.",
  tools: [tool],
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Remember this checkpoint prefix." }],
    },
  ],
};

function getRunFn(capabilities: readonly string[]): AiProviderRunFn {
  const runFn = getAiProviderRegistry().getRunFnFor(
    LOCAL_LLAMACPP,
    capabilities as Parameters<ReturnType<typeof getAiProviderRegistry>["getRunFnFor"]>[1]
  );
  expect(runFn).toBeDefined();
  return runFn!;
}

async function run(
  runFn: AiProviderRunFn,
  input: Record<string, unknown>,
  sessionContext: AiSessionContext | undefined,
  emitOverride: Parameters<AiProviderRunFn>[3] | undefined = undefined,
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  const { emit } = accumulatingEmit<TaskOutput>();
  await runFn(input, model, signal, emitOverride ?? emit, undefined, sessionContext);
}

async function warmCheckpoint(checkpointId: string): Promise<void> {
  await run(getRunFn(["cache.checkpoint"]), {}, { sessionId: checkpointId, prefix });
}

async function callTool(sessionContext: AiSessionContext | undefined): Promise<void> {
  await callToolWithPrompt("Find the weather.", sessionContext);
}

async function callToolWithPrompt(
  prompt: string,
  sessionContext: AiSessionContext | undefined,
  emitOverride: Parameters<AiProviderRunFn>[3] | undefined = undefined,
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  const input: ToolCallingTaskInput = {
    model,
    prompt,
    tools: [tool],
    toolChoice: "required",
    maxTokens: 16,
  };
  await run(
    getRunFn(["text.generation", "tool-use"]),
    input as unknown as Record<string, unknown>,
    sessionContext,
    emitOverride,
    signal
  );
}

describe("LlamaCpp tool-calling checkpoint lifecycle", () => {
  const sequences: Array<{ readonly id: number; readonly dispose: ReturnType<typeof vi.fn> }> = [];

  beforeEach(async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    await registerLlamaCppInline({ queue: { autoCreate: false } });
    sdkState.failure = undefined;
    sdkState.chatDisposeCount = 0;
    sdkState.sessionDisposeCount = 0;
    sdkState.chatSequences.length = 0;
    sdkState.generatedHistories.length = 0;
    sdkState.preloadPrompts.length = 0;
    sdkState.sessionHistories.length = 0;
    sequences.length = 0;
    llamaCppSessions.clear();
    llamaCppTextContexts.clear();
    llamaCppTextContexts.set(model.provider_config.model_path, {
      get sequencesLeft() {
        return 4;
      },
      getSequence() {
        const sequence = { id: sequences.length, dispose: vi.fn(async () => {}) };
        sequences.push(sequence);
        return sequence;
      },
    } as never);
  });

  afterEach(async () => {
    await releaseLlamaCppTransientSessions();
    llamaCppTextContexts.clear();
  });

  it("consumes a warmed checkpoint session and retains it under the emitted id", async () => {
    await warmCheckpoint("checkpoint-parent");
    const warmed = llamaCppSessions.get("checkpoint-parent");
    expect(warmed).toBeDefined();

    await callTool({
      sessionId: "checkpoint-parent",
      emitCheckpointId: "checkpoint-child",
      prefix,
    });

    expect(sdkState.chatSequences).toEqual([warmed!.sequence]);
    expect(sdkState.generatedHistories).toEqual([
      [
        {
          type: "system",
          text:
            "Use the lookup tool.\n\n" +
            "You must call at least one tool from the provided tool list when answering.",
        },
        { type: "user", text: "Remember this checkpoint prefix." },
        { type: "user", text: "Find the weather." },
      ],
    ]);
    expect(llamaCppSessions.has("checkpoint-parent")).toBe(false);
    expect(llamaCppSessions.get("checkpoint-child")?.sequence).toBe(warmed!.sequence);
  });

  it("reconstructs missing checkpoint state from the prefix before retaining the emit", async () => {
    await warmCheckpoint("checkpoint-missing");
    await deleteLlamaCppSession("checkpoint-missing");
    sdkState.preloadPrompts.length = 0;

    await callTool({
      sessionId: "checkpoint-missing",
      emitCheckpointId: "checkpoint-rebuilt",
      prefix,
    });

    expect(sdkState.preloadPrompts).toEqual([
      "Available tools:\n- lookup: Look up a query\n\nuser: Remember this checkpoint prefix.",
    ]);
    expect(sdkState.generatedHistories).toEqual([
      [
        {
          type: "system",
          text:
            "Use the lookup tool.\n\n" +
            "You must call at least one tool from the provided tool list when answering.",
        },
        { type: "user", text: "Remember this checkpoint prefix." },
        { type: "user", text: "Find the weather." },
      ],
    ]);
    expect(llamaCppSessions.has("checkpoint-missing")).toBe(false);
    expect(llamaCppSessions.get("checkpoint-rebuilt")?.sequence).toBe(sdkState.chatSequences[0]);
  });

  it("retains the emitted tool turn in session history and replays it on consumption", async () => {
    await warmCheckpoint("checkpoint-parent");
    await callTool({
      sessionId: "checkpoint-parent",
      emitCheckpointId: "checkpoint-child",
      prefix,
    });

    const emitted = llamaCppSessions.get("checkpoint-child");
    expect(emitted).toBeDefined();
    expect(emitted!.session.getChatHistory().at(-1)).toEqual({
      type: "model",
      response: [
        "calling",
        {
          type: "functionCall",
          name: "lookup",
          description: "Look up a query",
          params: { query: "weather" },
        },
      ],
    });

    const emittedPrefix: CheckpointPrefix = {
      ...prefix,
      messages: [
        ...prefix.messages!,
        { role: "user", content: [{ type: "text", text: "Find the weather." }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            {
              type: "tool_use",
              id: "call_0",
              name: "lookup",
              input: { query: "weather" },
            },
          ],
        },
      ],
    };
    sdkState.generatedHistories.length = 0;

    await callToolWithPrompt("Use the previous tool turn.", {
      sessionId: "checkpoint-child",
      prefix: emittedPrefix,
    });

    expect(sdkState.generatedHistories[0]).toEqual([
      {
        type: "system",
        text:
          "Use the lookup tool.\n\n" +
          "You must call at least one tool from the provided tool list when answering.",
      },
      { type: "user", text: "Remember this checkpoint prefix." },
      { type: "user", text: "Find the weather." },
      {
        type: "model",
        response: [
          "calling",
          {
            type: "functionCall",
            name: "lookup",
            description: undefined,
            params: { query: "weather" },
            result: undefined,
          },
        ],
      },
      { type: "user", text: "Use the previous tool turn." },
    ]);
  });

  it("keeps calls without session context ephemeral", async () => {
    await callTool(undefined);

    expect(llamaCppSessions.size).toBe(0);
    expect(sequences).toHaveLength(1);
    expect(sdkState.chatDisposeCount).toBe(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes checkpoint resources when generation throws synchronously", async () => {
    await warmCheckpoint("checkpoint-parent");
    sdkState.failure = "generate-sync";
    sdkState.chatDisposeCount = 0;
    sdkState.sessionDisposeCount = 0;

    await expect(
      callTool({
        sessionId: "checkpoint-parent",
        emitCheckpointId: "checkpoint-child",
        prefix,
      })
    ).rejects.toThrow("generation failed synchronously");

    expect(sdkState.chatDisposeCount).toBe(1);
    expect(sdkState.sessionDisposeCount).toBe(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
    expect(llamaCppSessions.has("checkpoint-parent")).toBe(false);
    expect(llamaCppSessions.has("checkpoint-child")).toBe(false);
  });

  it("settles generation and disposes resources when delta emission throws", async () => {
    await warmCheckpoint("checkpoint-parent");
    sdkState.chatDisposeCount = 0;
    sdkState.sessionDisposeCount = 0;

    await expect(
      callToolWithPrompt(
        "Find the weather.",
        {
          sessionId: "checkpoint-parent",
          emitCheckpointId: "checkpoint-child",
          prefix,
        },
        (event) => {
          if (event.type === "text-delta") throw new Error("delta emit failed");
        }
      )
    ).rejects.toThrow("delta emit failed");

    expect(sdkState.chatDisposeCount).toBe(1);
    expect(sdkState.sessionDisposeCount).toBe(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
    expect(llamaCppSessions.has("checkpoint-child")).toBe(false);
  });

  it("disposes checkpoint resources when generation aborts", async () => {
    await warmCheckpoint("checkpoint-parent");
    sdkState.chatDisposeCount = 0;
    sdkState.sessionDisposeCount = 0;
    const controller = new AbortController();
    controller.abort(new Error("generation aborted"));

    await expect(
      callToolWithPrompt(
        "Find the weather.",
        {
          sessionId: "checkpoint-parent",
          emitCheckpointId: "checkpoint-child",
          prefix,
        },
        undefined,
        controller.signal
      )
    ).rejects.toThrow("generation aborted");

    expect(sdkState.chatDisposeCount).toBe(1);
    expect(sdkState.sessionDisposeCount).toBe(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the consumed session and sequence when LlamaChat construction fails", async () => {
    await warmCheckpoint("checkpoint-parent");
    sdkState.failure = "chat-constructor";
    sdkState.sessionDisposeCount = 0;

    await expect(
      callTool({
        sessionId: "checkpoint-parent",
        emitCheckpointId: "checkpoint-child",
        prefix,
      })
    ).rejects.toThrow("chat constructor failed");

    expect(sdkState.sessionDisposeCount).toBe(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
    expect(llamaCppSessions.has("checkpoint-child")).toBe(false);
  });

  it("disposes a reconstructed session and sequence when prefix preload fails", async () => {
    sdkState.failure = "preload";

    await expect(warmCheckpoint("checkpoint-failed")).rejects.toThrow("preload failed");

    expect(sdkState.sessionDisposeCount).toBe(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
    expect(llamaCppSessions.has("checkpoint-failed")).toBe(false);
  });
});

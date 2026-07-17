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
  chatSequences: [] as unknown[],
  preloadPrompts: [] as string[],
};

vi.mock("node-llama-cpp", () => ({
  LlamaChat: class {
    readonly sequence: unknown;

    constructor(options: { readonly contextSequence: unknown }) {
      this.sequence = options.contextSequence;
      sdkState.chatSequences.push(this.sequence);
    }

    async generateResponse(
      _history: unknown,
      options: { readonly onTextChunk: (chunk: string) => void }
    ): Promise<{
      readonly response: string;
      readonly functionCalls: ReadonlyArray<{
        readonly functionName: string;
        readonly params: Record<string, unknown>;
      }>;
    }> {
      options.onTextChunk("calling");
      return {
        response: "calling",
        functionCalls: [{ functionName: "lookup", params: { query: "weather" } }],
      };
    }

    async dispose(): Promise<void> {}
  },
  LlamaChatSession: class {
    constructor(_options: { readonly contextSequence: unknown }) {}

    async preloadPrompt(prompt: string): Promise<void> {
      sdkState.preloadPrompts.push(prompt);
    }

    async dispose(): Promise<void> {}
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
  sessionContext: AiSessionContext | undefined
): Promise<void> {
  const { emit } = accumulatingEmit<TaskOutput>();
  await runFn(input, model, new AbortController().signal, emit, undefined, sessionContext);
}

async function warmCheckpoint(checkpointId: string): Promise<void> {
  await run(getRunFn(["cache.checkpoint"]), {}, { sessionId: checkpointId, prefix });
}

async function callTool(sessionContext: AiSessionContext | undefined): Promise<void> {
  const input: ToolCallingTaskInput = {
    prompt: "Find the weather.",
    tools: [tool],
    toolChoice: "required",
    maxTokens: 16,
  };
  await run(
    getRunFn(["text.generation", "tool-use"]),
    input as unknown as Record<string, unknown>,
    sessionContext
  );
}

describe("LlamaCpp tool-calling checkpoint lifecycle", () => {
  const sequences: Array<{ readonly id: number; readonly dispose: ReturnType<typeof vi.fn> }> = [];

  beforeEach(async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    await registerLlamaCppInline({ queue: { autoCreate: false } });
    sdkState.chatSequences.length = 0;
    sdkState.preloadPrompts.length = 0;
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
    expect(llamaCppSessions.has("checkpoint-missing")).toBe(false);
    expect(llamaCppSessions.get("checkpoint-rebuilt")?.sequence).toBe(sdkState.chatSequences[0]);
  });

  it("keeps calls without session context ephemeral", async () => {
    await callTool(undefined);

    expect(llamaCppSessions.size).toBe(0);
    expect(sequences).toHaveLength(1);
    expect(sequences[0].dispose).toHaveBeenCalledTimes(1);
  });
});

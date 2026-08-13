/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiSessionContext,
  CheckpointPrefix,
  TextGenerationTaskInput,
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

/**
 * TextGeneration mirror of `LlamaCpp_ToolCallingCheckpoint.test.ts` — proves
 * the same checkpoint fallback + steal-serialization semantics hold on the
 * text-generation code path (the plan's L3 test-coverage gap).
 */
const sdkState = {
  sessionSequences: [] as unknown[],
  sessionDisposeCount: 0,
  preloadPrompts: [] as string[],
  sessionHistories: [] as any[][],
  promptCalls: [] as { readonly prompt: string; readonly sequence: unknown }[],
};

/** Nominal token counts the fake SDK "encodes" per preload / generated turn. */
const PREFIX_TOKENS = 7;
const TURN_TOKENS = 3;

function advanceFakeSequence(sequence: unknown, tokens: number): void {
  const seq = sequence as { nextTokenIndex?: number };
  if (typeof seq?.nextTokenIndex === "number") seq.nextTokenIndex += tokens;
}

vi.mock("node-llama-cpp", () => ({
  LlamaChatSession: class {
    readonly sequence: unknown;
    private history: any[];
    private disposed = false;

    constructor(options: { readonly contextSequence: unknown; readonly systemPrompt?: string }) {
      this.sequence = options.contextSequence;
      sdkState.sessionSequences.push(this.sequence);
      this.history =
        options.systemPrompt === undefined ? [] : [{ type: "system", text: options.systemPrompt }];
    }

    async preloadPrompt(prompt: string): Promise<void> {
      sdkState.preloadPrompts.push(prompt);
      advanceFakeSequence(this.sequence, PREFIX_TOKENS);
    }

    getChatHistory(): any[] {
      return structuredClone(this.history);
    }

    setChatHistory(history: any[]): void {
      this.history = structuredClone(history);
      sdkState.sessionHistories.push(structuredClone(history));
    }

    async prompt(
      prompt: string,
      options: {
        readonly onTextChunk: (chunk: string) => void;
        readonly signal: AbortSignal;
      }
    ): Promise<string> {
      sdkState.promptCalls.push({ prompt, sequence: this.sequence });
      if (options.signal.aborted) return Promise.reject(options.signal.reason);
      advanceFakeSequence(this.sequence, TURN_TOKENS);
      options.onTextChunk("out");
      return "out";
    }

    async dispose(): Promise<void> {
      if (this.disposed) return;
      this.disposed = true;
      sdkState.sessionDisposeCount += 1;
    }
  },
}));

const model: LlamaCppModelRecord = {
  model_id: "llamacpp:test-textgen-checkpoint",
  title: "Test textgen checkpoint model",
  description: "Provider-level checkpoint lifecycle fixture",
  capabilities: ["text.generation", "cache.checkpoint"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "/tmp/test-textgen-checkpoint.gguf",
  },
  metadata: {},
};

const prefix: CheckpointPrefix = {
  systemPrompt: "You are helpful.",
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

async function generate(
  prompt: string,
  sessionContext: AiSessionContext | undefined
): Promise<void> {
  const input: TextGenerationTaskInput = { model, prompt, maxTokens: 8 } as never;
  await run(
    getRunFn(["text.generation"]),
    input as unknown as Record<string, unknown>,
    sessionContext
  );
}

interface FakeSequence {
  readonly id: number;
  nextTokenIndex: number;
  readonly eraseContextTokenRanges: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
}

describe("LlamaCpp text-generation checkpoint lifecycle", () => {
  const sequences: FakeSequence[] = [];

  beforeEach(async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    await registerLlamaCppInline({ queue: { autoCreate: false } });
    sdkState.sessionSequences.length = 0;
    sdkState.sessionDisposeCount = 0;
    sdkState.preloadPrompts.length = 0;
    sdkState.sessionHistories.length = 0;
    sdkState.promptCalls.length = 0;
    sequences.length = 0;
    llamaCppSessions.clear();
    llamaCppTextContexts.clear();
    llamaCppTextContexts.set(model.provider_config.model_path, {
      get sequencesLeft() {
        return 4;
      },
      getSequence() {
        const sequence: FakeSequence = {
          id: sequences.length,
          nextTokenIndex: 0,
          eraseContextTokenRanges: vi.fn(async (ranges: Array<{ start: number; end: number }>) => {
            for (const { start, end } of ranges) {
              sequence.nextTokenIndex -= end - start;
            }
          }),
          dispose: vi.fn(async () => {}),
        };
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
    await warmCheckpoint("ckpt-parent");
    const warmed = llamaCppSessions.get("ckpt-parent");
    expect(warmed).toBeDefined();

    await generate("continue the story", {
      sessionId: "ckpt-parent",
      emitCheckpointId: "ckpt-child",
      supersedeParent: true,
      prefix,
    });

    // The consumer ran on the warmed sequence (stolen atomically).
    expect(sdkState.promptCalls.map((c) => c.sequence)).toEqual([warmed!.sequence]);
    expect(sdkState.promptCalls[0].prompt).toBe("continue the story");
    // The parent id is gone (superseded by the emit under a different id).
    expect(llamaCppSessions.has("ckpt-parent")).toBe(false);
    expect(llamaCppSessions.get("ckpt-child")?.sequence).toBe(warmed!.sequence);
  });

  it("reconstructs missing checkpoint state from the prefix", async () => {
    await warmCheckpoint("ckpt-missing");
    await deleteLlamaCppSession("ckpt-missing");
    sdkState.preloadPrompts.length = 0;
    sdkState.sessionHistories.length = 0;

    await generate("continue", { sessionId: "ckpt-missing", prefix });

    // Fallback preloads via the empty-string route (chat template via setChatHistory + functions).
    expect(sdkState.preloadPrompts).toEqual([""]);
    expect(sdkState.sessionHistories[0]).toEqual([
      { type: "system", text: "You are helpful." },
      { type: "user", text: "Remember this checkpoint prefix." },
    ]);
    // The re-encoded session is rewound and restored under the checkpoint id,
    // so the next consumer reuses it instead of re-encoding again.
    expect(llamaCppSessions.has("ckpt-missing")).toBe(true);
  });

  it("restores the consumed checkpoint so a second consumption reuses the warmed state", async () => {
    await warmCheckpoint("ckpt-reuse");
    const warmed = llamaCppSessions.get("ckpt-reuse");
    expect(warmed).toBeDefined();
    const warmedSequence = warmed!.sequence as FakeSequence;
    expect(warmedSequence.nextTokenIndex).toBe(PREFIX_TOKENS);
    sdkState.preloadPrompts.length = 0;
    sdkState.sessionHistories.length = 0;

    await generate("first consumption", { sessionId: "ckpt-reuse", prefix });

    // Restored under the checkpoint id: same sequence, KV rewound back to the
    // prefix boundary, history reset to the prefix rendering.
    expect(llamaCppSessions.get("ckpt-reuse")?.sequence).toBe(warmedSequence);
    expect(warmedSequence.eraseContextTokenRanges).toHaveBeenCalledWith([
      { start: PREFIX_TOKENS, end: PREFIX_TOKENS + TURN_TOKENS },
    ]);
    expect(warmedSequence.nextTokenIndex).toBe(PREFIX_TOKENS);
    expect(sdkState.sessionHistories.at(-1)).toEqual([
      { type: "system", text: "You are helpful." },
      { type: "user", text: "Remember this checkpoint prefix." },
    ]);

    await generate("second consumption", { sessionId: "ckpt-reuse", prefix });

    // The second consumption reused the restored warm state — both prompts ran
    // on the warmed sequence and no prefix re-encode (preload) ever happened.
    expect(sdkState.promptCalls.map((c) => c.sequence)).toEqual([warmedSequence, warmedSequence]);
    expect(sdkState.preloadPrompts).toEqual([]);
    expect(llamaCppSessions.get("ckpt-reuse")?.sequence).toBe(warmedSequence);
  });

  it("keeps the parent's warmed state on a non-superseding emit (emitted id gets no local state)", async () => {
    await warmCheckpoint("ckpt-keep");
    const warmed = llamaCppSessions.get("ckpt-keep");
    expect(warmed).toBeDefined();

    // keepParentCheckpoint flow: the task layer omits supersedeParent.
    await generate("branching turn", {
      sessionId: "ckpt-keep",
      emitCheckpointId: "ckpt-branch",
      prefix,
    });

    // The parent keeps its warmed state; the emitted id carries no local KV
    // state (its consumers take the documented re-encode fallback).
    expect(llamaCppSessions.get("ckpt-keep")?.sequence).toBe(warmed!.sequence);
    expect(llamaCppSessions.has("ckpt-branch")).toBe(false);
  });

  it("serializes concurrent consumers — winner reuses the warmed sequence, loser re-encodes", async () => {
    await warmCheckpoint("ckpt-shared");
    const warmed = llamaCppSessions.get("ckpt-shared");
    expect(warmed).toBeDefined();
    sdkState.preloadPrompts.length = 0;
    sdkState.sessionHistories.length = 0;

    await Promise.all([
      generate("Consumer A prompt.", { sessionId: "ckpt-shared", prefix }),
      generate("Consumer B prompt.", { sessionId: "ckpt-shared", prefix }),
    ]);

    // Two distinct sequences drove the two prompts — the loser could not
    // have shared the warmed sequence with the winner.
    const distinct = new Set(sdkState.promptCalls.map((c) => c.sequence));
    expect(distinct.size).toBe(2);
    expect(sdkState.promptCalls.some((c) => c.sequence === warmed!.sequence)).toBe(true);
    // Exactly one loser re-encoded via the fallback.
    expect(sdkState.preloadPrompts).toEqual([""]);
    // Exactly one finisher restored the checkpoint id (the other disposed its
    // session instead of overwriting the restored entry).
    expect(llamaCppSessions.has("ckpt-shared")).toBe(true);
  });

  // The unified ["text.generation"] run-fn routes messages-shaped inputs to
  // the chat path; these cover its missing-session rebuild.
  it("re-encodes prefix + all prior turns when a checkpoint-seeded chat session is missing mid-conversation", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "turn one" }] },
      { role: "assistant", content: [{ type: "text", text: "reply one" }] },
      { role: "user", content: [{ type: "text", text: "turn two" }] },
    ];

    await run(
      getRunFn(["text.generation"]),
      { model, messages, systemPrompt: "caller sys" } as never,
      { sessionId: "chat-rebuilt", ownedSession: true, prefix }
    );

    expect(sdkState.preloadPrompts).toEqual([""]);
    // The rebuild history carries the EFFECTIVE system prompt (the caller's
    // wins over the prefix's), the checkpoint prefix's conversation, and every
    // conversation turn before the final user turn — which is prompted.
    expect(sdkState.sessionHistories[0]).toEqual([
      { type: "system", text: "caller sys" },
      { type: "user", text: "Remember this checkpoint prefix." },
      { type: "user", text: "turn one" },
      { type: "model", response: ["reply one"] },
    ]);
    expect(sdkState.promptCalls.map((c) => c.prompt)).toEqual(["turn two"]);
    expect(llamaCppSessions.get("chat-rebuilt")?.mode).toBe("progressive");
  });

  it("re-encodes prior turns when a plain chat session is missing mid-conversation", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "turn one" }] },
      { role: "assistant", content: [{ type: "text", text: "reply one" }] },
      { role: "user", content: [{ type: "text", text: "turn two" }] },
    ];

    await run(getRunFn(["text.generation"]), { model, messages } as never, {
      sessionId: "chat-plain",
    });

    expect(sdkState.preloadPrompts).toEqual([""]);
    expect(sdkState.sessionHistories[0]).toEqual([
      { type: "user", text: "turn one" },
      { type: "model", response: ["reply one"] },
    ]);
    expect(sdkState.promptCalls.map((c) => c.prompt)).toEqual(["turn two"]);
  });

  it("does not preload anything for a plain first-turn chat", async () => {
    await run(
      getRunFn(["text.generation"]),
      { model, messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] } as never,
      { sessionId: "chat-fresh" }
    );

    expect(sdkState.preloadPrompts).toEqual([]);
    expect(sdkState.sessionHistories).toEqual([]);
    expect(sdkState.promptCalls.map((c) => c.prompt)).toEqual(["hello"]);
  });
});

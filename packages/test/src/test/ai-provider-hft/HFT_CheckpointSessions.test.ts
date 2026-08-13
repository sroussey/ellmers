/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiProviderRunFn,
  AiSessionContext,
  ChatMessage,
  CheckpointPrefix,
  TextGenerationTaskInput,
  ToolCallingTaskInput,
} from "@workglow/ai";
import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HFT_CacheCheckpoint,
  renderHftContinuationPrompt,
  renderHftPrefixPrompt,
} from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_CacheCheckpoint";
import { HFT_Chat } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_Chat";
import { HFT_RUN_FNS } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_JobRunFns";
import {
  clearPipelineCache,
  deleteHftSession,
  getHftSession,
  getPipelineCacheKey,
  hasGpuBufferEntries,
  loadTransformersSDK,
  pipelines,
  setHftSession,
} from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_Pipeline";
import { HFT_SessionDispose } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_SessionDispose";
import { HFT_TextGeneration } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_TextGeneration";
import { HFT_ToolCalling } from "../../../../../providers/huggingface-transformers/src/ai/common/HFT_ToolCalling";
import { HuggingFaceTransformersQueuedProvider } from "../../../../../providers/huggingface-transformers/src/ai/HuggingFaceTransformersQueuedProvider";

/** Generated text the fake model "produces" (also fed through the streamer). */
const REPLY = "REPLY";

const model = {
  model_id: "hft-test-model",
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: { model_path: "test-org/fake-model", pipeline: "text-generation" },
} as never;
const modelPath = "test-org/fake-model";
const cacheKey = getPipelineCacheKey(model);

const userMessage = (text: string): ChatMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});
const assistantMessage = (text: string): ChatMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

interface GenerateCall {
  readonly promptLen: number;
  /** `get_seq_length()` of the attached cache at call time; -1 = none attached. */
  readonly pastLenAtCall: number;
  readonly maxNewTokens: number;
}
interface TemplateCall {
  readonly messageCount: number;
  readonly addGenerationPrompt: boolean;
}

/**
 * Concatenative Qwen-style fake template: a standing tools header, one
 * `<role>content</role>` block per message, and a trailing `<assistant>`
 * generation marker — so a continuation render always starts byte-for-byte
 * with the prefix render (1 char = 1 "token" via the length-based tokenizer).
 */
function renderTemplate(
  messages: Array<Record<string, unknown>>,
  options: { tools?: Array<{ function: { name: string } }>; add_generation_prompt?: boolean }
): string {
  let out = "";
  if (options.tools && options.tools.length > 0) {
    out += `[TOOLS ${options.tools.map((t) => t.function.name).join(",")}]\n`;
  }
  for (const m of messages) {
    out += `<${m.role}>${String(m.content)}</${m.role}>\n`;
  }
  if (options.add_generation_prompt) {
    out += "<assistant>";
  }
  return out;
}

function makeFakeTokenizer(templateCalls: TemplateCall[]) {
  return Object.assign((text: string) => ({ input_ids: { dims: [1, text.length] } }), {
    all_special_ids: [] as number[],
    apply_chat_template: (messages: Array<Record<string, unknown>>, options: any) => {
      templateCalls.push({
        messageCount: messages.length,
        addGenerationPrompt: options?.add_generation_prompt === true,
      });
      return renderTemplate(messages, options ?? {});
    },
    decode: () => "",
  });
}

async function makeFakePipeline(): Promise<{
  pipeline: any;
  generateCalls: GenerateCall[];
  templateCalls: TemplateCall[];
}> {
  const sdk = await loadTransformersSDK();
  const generateCalls: GenerateCall[] = [];
  const templateCalls: TemplateCall[] = [];
  const tokenizer = makeFakeTokenizer(templateCalls);
  const makeTensor = (seqLen: number) =>
    new sdk.Tensor("float32", new Float32Array(seqLen * 2), [1, 1, seqLen, 2]);
  const hfModel = {
    generate: vi.fn(async (args: any) => {
      const promptLen: number = args.input_ids.dims[1];
      const generated = args.max_new_tokens === 0 ? 0 : REPLY.length;
      const past = args.past_key_values;
      generateCalls.push({
        promptLen,
        pastLenAtCall: past?.get_seq_length ? past.get_seq_length() : -1,
        maxNewTokens: args.max_new_tokens,
      });
      if (past) {
        // Simulate encoding: rebind the flat entries to full-length tensors,
        // exactly how transformers.js DynamicCache.update behaves.
        past.update({
          "past_key_values.0.key": makeTensor(promptLen + generated),
          "past_key_values.0.value": makeTensor(promptLen + generated),
        });
      }
      if (generated > 0) {
        args.streamer?.callback_function?.(REPLY);
      }
      return { dims: [1, promptLen + generated] };
    }),
  };
  const pipeline: any = async (promptOrMessages: unknown, opts: Record<string, unknown>) => {
    const text =
      typeof promptOrMessages === "string"
        ? promptOrMessages
        : renderTemplate(promptOrMessages as Array<Record<string, unknown>>, {
            add_generation_prompt: true,
          });
    await hfModel.generate({ ...tokenizer(text), ...opts });
    return [{ generated_text: "" }];
  };
  pipeline.tokenizer = tokenizer;
  pipeline.model = hfModel;
  return { pipeline, generateCalls, templateCalls };
}

const emitNoop = () => undefined;
const signal = () => new AbortController().signal;

let fake: Awaited<ReturnType<typeof makeFakePipeline>>;

beforeAll(async () => {
  await loadTransformersSDK();
});

beforeEach(async () => {
  await clearPipelineCache();
  fake = await makeFakePipeline();
  pipelines.set(cacheKey, fake.pipeline);
});

afterEach(async () => {
  await clearPipelineCache();
});

// ============================================================================
// H4 — tools-only prefix renders via an empty message list (no placeholder)
// ============================================================================

describe("renderHftPrefixPrompt tools-only parity", () => {
  const toolsPrefix: CheckpointPrefix = {
    tools: [{ name: "get_weather", description: "d", inputSchema: { type: "object" } }],
  };

  it("renders a tools-only prefix from an empty message list with continuation parity", () => {
    const templateCalls: TemplateCall[] = [];
    const tokenizer = makeFakeTokenizer(templateCalls);
    const prefixPrompt = renderHftPrefixPrompt(tokenizer as any, toolsPrefix);
    expect(prefixPrompt).toBe("[TOOLS get_weather]\n");
    expect(prefixPrompt).not.toContain("<user>");

    const continuation = renderHftContinuationPrompt(tokenizer as any, toolsPrefix, "hi");
    expect(continuation.startsWith(prefixPrompt)).toBe(true);
  });

  it("falls back to the placeholder turn only when the template rejects an empty list", () => {
    const templateCalls: TemplateCall[] = [];
    const strict = makeFakeTokenizer(templateCalls);
    const original = strict.apply_chat_template;
    strict.apply_chat_template = (messages: Array<Record<string, unknown>>, options: any) => {
      if (messages.length === 0) throw new Error("empty message list not supported");
      return original(messages, options);
    };
    const prefixPrompt = renderHftPrefixPrompt(strict as any, toolsPrefix);
    expect(prefixPrompt).toContain("<user></user>");
  });

  it("fingerprint KV reuse works for tool calls without a systemPrompt", async () => {
    const input = {
      tools: [{ name: "get_weather", description: "d", inputSchema: { type: "object" } }],
      prompt: "what is the weather",
      model,
    } as unknown as ToolCallingTaskInput;
    const ctx: AiSessionContext = { sessionId: "fp-1" };

    await HFT_ToolCalling(input, model, signal(), emitNoop, undefined, ctx);
    const prefixLen = "[TOOLS get_weather]\n".length;
    // Warm-up encode of the shared region, then generation from the snapshot.
    expect(fake.generateCalls.map((c) => c.maxNewTokens === 0)).toEqual([true, false]);
    expect(fake.generateCalls[0].promptLen).toBe(prefixLen);
    expect(fake.generateCalls[1].pastLenAtCall).toBe(prefixLen);
    const session = getHftSession("fp-1");
    expect(session?.mode).toBe("prefix-rewind");
    expect((session as { encodedText?: string }).encodedText).toBe("[TOOLS get_weather]\n");

    // Second same-fingerprint call: no re-warm, anchor comes from the stored
    // encodedText (no additional prefix re-render).
    const prefixRenders = fake.templateCalls.filter((c) => !c.addGenerationPrompt).length;
    await HFT_ToolCalling(input, model, signal(), emitNoop, undefined, ctx);
    expect(fake.generateCalls).toHaveLength(3);
    expect(fake.generateCalls[2].maxNewTokens).not.toBe(0);
    expect(fake.generateCalls[2].pastLenAtCall).toBe(prefixLen);
    expect(fake.templateCalls.filter((c) => !c.addGenerationPrompt).length).toBe(prefixRenders);
  });
});

// ============================================================================
// H7 — checkpoint consumers honor the caller's systemPrompt
// ============================================================================

describe("checkpoint caller systemPrompt", () => {
  const prefix: CheckpointPrefix = {
    systemPrompt: "prefix system",
    messages: [userMessage("warm question")],
  };

  it("tool calling renders the caller systemPrompt and re-encodes (parity broken)", async () => {
    await HFT_CacheCheckpoint({ model }, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-h7",
      prefix,
    });
    fake.generateCalls.length = 0;

    const input = {
      tools: [],
      prompt: "next question",
      systemPrompt: "caller system",
      model,
    } as unknown as ToolCallingTaskInput;
    await HFT_ToolCalling(input, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-h7",
      prefix,
    });

    // Full re-encode: nothing attached, no extra warm-up encode.
    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0].pastLenAtCall).toBe(-1);
    // The fed prompt carried the caller's systemPrompt, not the prefix's.
    const fedLen = fake.generateCalls[0].promptLen;
    const expected = renderTemplate(
      [
        { role: "system", content: "caller system" },
        { role: "user", content: "warm question" },
        { role: "user", content: "next question" },
      ],
      { add_generation_prompt: true }
    );
    expect(fedLen).toBe(expected.length);
  });

  it("text generation keeps the prefix systemPrompt when the input carries none", async () => {
    await HFT_CacheCheckpoint({ model }, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-h7b",
      prefix,
    });
    fake.generateCalls.length = 0;

    const input = { prompt: "next question", model, maxTokens: 8 } as TextGenerationTaskInput;
    await HFT_TextGeneration(input, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-h7b",
      prefix,
    });

    // Parity holds against the warmed prefix, so the snapshot attaches.
    const prefixLen = renderTemplate(
      [
        { role: "system", content: "prefix system" },
        { role: "user", content: "warm question" },
      ],
      {}
    ).length;
    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0].pastLenAtCall).toBe(prefixLen);
  });
});

// ============================================================================
// H5 side — consumers compare against the stored encodedText (no re-render)
// ============================================================================

describe("text generation checkpoint consumption", () => {
  const prefix: CheckpointPrefix = {
    systemPrompt: "prefix system",
    messages: [userMessage("warm question")],
  };

  it("attaches the warmed snapshot via its stored encodedText without re-rendering", async () => {
    await HFT_CacheCheckpoint({ model }, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-tg",
      prefix,
    });
    const warmPrefixRenders = fake.templateCalls.filter((c) => !c.addGenerationPrompt).length;
    expect(warmPrefixRenders).toBe(1);

    const input = { prompt: "q1", model, maxTokens: 8 } as TextGenerationTaskInput;
    await HFT_TextGeneration(input, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-tg",
      prefix,
    });

    const session = getHftSession("ckpt-tg");
    expect(session?.mode).toBe("prefix-rewind");
    const prefixLen = (session as { baseSeqLength: number }).baseSeqLength;
    expect(fake.generateCalls.at(-1)?.pastLenAtCall).toBe(prefixLen);
    // Consumption rendered only the continuation — the prefix was not
    // re-rendered because the anchor came from the stored encodedText.
    expect(fake.templateCalls.filter((c) => !c.addGenerationPrompt).length).toBe(warmPrefixRenders);
  });

  it("re-encodes and restores the snapshot when the checkpoint state is missing", async () => {
    await HFT_CacheCheckpoint({ model }, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-missing",
      prefix,
    });
    deleteHftSession("ckpt-missing");
    fake.generateCalls.length = 0;

    const input = { prompt: "q1", model, maxTokens: 8 } as TextGenerationTaskInput;
    await HFT_TextGeneration(input, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-missing",
      prefix,
    });

    // Prefix re-encode (max_new_tokens 0), then generation from the restored KV.
    expect(fake.generateCalls.map((c) => c.maxNewTokens === 0)).toEqual([true, false]);
    expect(fake.generateCalls[1].pastLenAtCall).toBe(fake.generateCalls[0].promptLen);
    expect(getHftSession("ckpt-missing")?.mode).toBe("prefix-rewind");
  });
});

// ============================================================================
// H5 — chat snapshot reuse decoupled from checkpoint-prefix parity
// ============================================================================

describe("chat own-snapshot reuse", () => {
  const prefix: CheckpointPrefix = {
    systemPrompt: "prefix system",
    messages: [userMessage("warm question")],
  };

  it("stores a snapshot despite parity failure and reuses it from turn 2", async () => {
    const ctx: AiSessionContext = { sessionId: "owned-h5", ownedSession: true, prefix };

    // Turn 1: the caller's own systemPrompt permanently diverges the render
    // from the checkpoint prefix, so checkpoint parity fails.
    await HFT_Chat(
      {
        messages: [userMessage("q1")],
        systemPrompt: "caller system",
      } as unknown as AiChatProviderInput,
      model,
      signal(),
      emitNoop,
      undefined,
      ctx
    );

    // Parity failed, so nothing was attached — but an empty cache was, so a
    // snapshot exists for the next turn.
    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0].pastLenAtCall).toBe(0);
    const turn1 = getHftSession("owned-h5");
    expect(turn1?.mode).toBe("prefix-rewind");
    const turn1Len = fake.generateCalls[0].promptLen + REPLY.length;
    expect((turn1 as { baseSeqLength: number }).baseSeqLength).toBe(turn1Len);
    expect((turn1 as { encodedText?: string }).encodedText?.endsWith(REPLY)).toBe(true);

    // Turn 2: the previous turn's snapshot attaches via its own encodedText,
    // independent of checkpoint parity — no full re-encode of the history.
    await HFT_Chat(
      {
        messages: [userMessage("q1"), assistantMessage(REPLY), userMessage("q2")],
        systemPrompt: "caller system",
      } as unknown as AiChatProviderInput,
      model,
      signal(),
      emitNoop,
      undefined,
      ctx
    );

    expect(fake.generateCalls).toHaveLength(2);
    expect(fake.generateCalls[1].pastLenAtCall).toBe(turn1Len);
    const turn2 = getHftSession("owned-h5");
    expect((turn2 as { baseSeqLength: number }).baseSeqLength).toBe(
      fake.generateCalls[1].promptLen + REPLY.length
    );
  });
});

// ============================================================================
// H6 — turn-1 chat seed from the checkpoint's warmed snapshot
// ============================================================================

describe("chat seed from checkpoint snapshot", () => {
  const prefix: CheckpointPrefix = {
    systemPrompt: "prefix system",
    messages: [userMessage("warm question")],
  };

  it("seeds turn 1 from seedCheckpointId without re-encoding the prefix", async () => {
    await HFT_CacheCheckpoint({ model }, model, signal(), emitNoop, undefined, {
      sessionId: "ckpt-seed",
      prefix,
    });
    const seedBefore = getHftSession("ckpt-seed");
    expect(seedBefore?.mode).toBe("prefix-rewind");
    const seedLen = (seedBefore as { baseSeqLength: number }).baseSeqLength;
    fake.generateCalls.length = 0;

    const ctx: AiSessionContext = {
      sessionId: "chat-seeded",
      ownedSession: true,
      seedCheckpointId: "ckpt-seed",
      prefix,
    };
    await HFT_Chat(
      { messages: [userMessage("q1")] } as unknown as AiChatProviderInput,
      model,
      signal(),
      emitNoop,
      undefined,
      ctx
    );

    // Exactly one generation call: no max_new_tokens=0 prefix re-encode, and
    // the seed snapshot's KV was attached.
    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0].maxNewTokens).not.toBe(0);
    expect(fake.generateCalls[0].pastLenAtCall).toBe(seedLen);

    // The seed entry is untouched; the chat snapshotted under its OWN id.
    const seedAfter = getHftSession("ckpt-seed");
    expect(seedAfter).toBe(seedBefore);
    expect((seedAfter as { baseSeqLength: number }).baseSeqLength).toBe(seedLen);
    const own = getHftSession("chat-seeded");
    expect(own?.mode).toBe("prefix-rewind");
    expect((own as { baseSeqLength: number }).baseSeqLength).toBe(
      fake.generateCalls[0].promptLen + REPLY.length
    );
  });
});

// ============================================================================
// H3 — gpu-buffer guard and dispose tolerance
// ============================================================================

describe("gpu-buffer snapshot guard", () => {
  it("hasGpuBufferEntries detects gpu-buffer tensors", () => {
    expect(hasGpuBufferEntries({})).toBe(false);
    expect(hasGpuBufferEntries({ a: { location: "cpu" } })).toBe(false);
    expect(hasGpuBufferEntries({ a: { location: "cpu" }, b: { location: "gpu-buffer" } })).toBe(
      true
    );
  });

  it("chat skips attaching a gpu-buffer snapshot and re-encodes instead", async () => {
    // A snapshot whose tensors live on the GPU: attaching it would let the
    // first decode step dispose the shared entries (use-after-free).
    setHftSession("chat-gpu", {
      mode: "prefix-rewind",
      baseEntries: { "past_key_values.0.key": { location: "gpu-buffer" } },
      baseSeqLength: 5,
      modelPath,
      cacheKey,
      encodedText: "<user>q1</user>\n",
    });

    await HFT_Chat(
      { messages: [userMessage("q1")] } as unknown as AiChatProviderInput,
      model,
      signal(),
      emitNoop,
      undefined,
      { sessionId: "chat-gpu" }
    );

    // Guard tripped: nothing attached (fresh empty cache instead).
    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0].pastLenAtCall).toBe(0);
    // The post-turn snapshot replaced the gpu entry with this turn's KV.
    const session = getHftSession("chat-gpu");
    expect(hasGpuBufferEntries((session as { baseEntries: Record<string, any> }).baseEntries)).toBe(
      false
    );
  });

  it("deleteHftSession tolerates tensors whose dispose throws", () => {
    setHftSession("dispose-throws", {
      mode: "prefix-rewind",
      baseEntries: {
        t: {
          location: "gpu-buffer",
          dispose: () => {
            throw new Error("already disposed");
          },
        },
      },
      baseSeqLength: 1,
      modelPath,
      cacheKey,
    });
    expect(() => deleteHftSession("dispose-throws")).not.toThrow();
    expect(getHftSession("dispose-throws")).toBeUndefined();

    setHftSession("dispose-throws-progressive", {
      mode: "progressive",
      cache: {
        dispose: () => {
          throw new Error("already disposed");
        },
      } as never,
      modelPath,
      cacheKey,
    });
    expect(() => deleteHftSession("dispose-throws-progressive")).not.toThrow();
    expect(getHftSession("dispose-throws-progressive")).toBeUndefined();
  });
});

// ============================================================================
// H1 — session.dispose run-fn and provider dispatch
// ============================================================================

describe("session disposal", () => {
  const originalRegistry = getAiProviderRegistry();

  afterEach(() => {
    setAiProviderRegistry(originalRegistry);
  });

  it("registers a session.dispose run-fn in HFT_RUN_FNS", () => {
    const registration = HFT_RUN_FNS.find(({ serves }) => serves.includes("session.dispose"));
    expect(registration).toBeDefined();
  });

  it("removes a runtime-local session through the run function", async () => {
    setHftSession("sd-1", {
      mode: "prefix-rewind",
      baseEntries: {},
      baseSeqLength: 0,
      modelPath,
      cacheKey,
    });
    const events: unknown[] = [];
    await HFT_SessionDispose(
      {},
      undefined,
      AbortSignal.timeout(1_000),
      (e) => {
        events.push(e);
      },
      undefined,
      { sessionId: "sd-1" }
    );
    expect(getHftSession("sd-1")).toBeUndefined();
    expect(events).toEqual([{ type: "finish", data: {} }]);
  });

  it("provider disposeSession dispatches through the registered run-fn", async () => {
    const registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);
    const dispatched = vi.fn(HFT_SessionDispose);
    registry.registerRunFn("HF_TRANSFORMERS_ONNX", {
      serves: ["session.dispose"] as const,
      runFn: dispatched as unknown as AiProviderRunFn,
    });
    setHftSession("sd-2", {
      mode: "prefix-rewind",
      baseEntries: {},
      baseSeqLength: 0,
      modelPath,
      cacheKey,
    });

    const provider = new HuggingFaceTransformersQueuedProvider(HFT_RUN_FNS);
    await provider.disposeSession("sd-2");

    expect(dispatched).toHaveBeenCalledOnce();
    expect(getHftSession("sd-2")).toBeUndefined();
  });

  it("provider disposeSession falls back to the local map when unregistered", async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    setHftSession("sd-3", {
      mode: "prefix-rewind",
      baseEntries: {},
      baseSeqLength: 0,
      modelPath,
      cacheKey,
    });
    const provider = new HuggingFaceTransformersQueuedProvider(HFT_RUN_FNS);
    await provider.disposeSession("sd-3");
    expect(getHftSession("sd-3")).toBeUndefined();
  });
});

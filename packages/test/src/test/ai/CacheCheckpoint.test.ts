/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  AiSessionContext,
  Capability,
  CheckpointEntry,
  ModelConfig,
} from "@workglow/ai";
import {
  AiProvider,
  AiProviderRegistry,
  CAPABILITIES,
  CacheCheckpointTask,
  ToolCallingTask,
  cacheCheckpoint,
  checkpointModelKey,
  clearCheckpointsForTesting,
  deleteCheckpoint,
  getAiProviderRegistry,
  getCheckpoint,
  registerCheckpoint,
  setAiProviderRegistry,
} from "@workglow/ai";
import type { StreamEvent, TaskOutput } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cache.checkpoint capability", () => {
  it("is a recognized capability", () => {
    expect(CAPABILITIES["cache.checkpoint"]).toBeDefined();
  });
});

describe("CheckpointRegistry", () => {
  beforeEach(() => {
    clearCheckpointsForTesting();
  });

  const entry: CheckpointEntry = {
    provider: "TEST_PROVIDER",
    modelKey: "test:model:v1",
    prefix: {
      systemPrompt: "You are helpful.",
      tools: [{ name: "a", description: "A", inputSchema: { type: "object" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    },
  };

  it("registers and retrieves an entry", () => {
    registerCheckpoint("ckpt-1", entry);
    expect(getCheckpoint("ckpt-1")).toEqual(entry);
  });

  it("returns undefined for unknown ids", () => {
    expect(getCheckpoint("nope")).toBeUndefined();
  });

  it("deletes entries", () => {
    registerCheckpoint("ckpt-1", entry);
    expect(deleteCheckpoint("ckpt-1")).toBe(true);
    expect(getCheckpoint("ckpt-1")).toBeUndefined();
    expect(deleteCheckpoint("ckpt-1")).toBe(false);
  });

  it("checkpointModelKey uses model_id and falls back to empty string", () => {
    expect(checkpointModelKey({ model_id: "m1" } as unknown as ModelConfig)).toBe("m1");
    expect(checkpointModelKey({} as ModelConfig)).toBe("");
  });
});

const CKPT_PROVIDER = "checkpoint-test-provider";
const CACHE_CHECKPOINT: readonly Capability[] = ["cache.checkpoint"];

function checkpointModel(): ModelConfig {
  return {
    model_id: "test:ckpt-model:v1",
    title: "ckpt-model",
    description: "ckpt-model",
    capabilities: ["cache.checkpoint", "text.generation"],
    provider: CKPT_PROVIDER,
    provider_config: {},
    metadata: {},
  } as unknown as ModelConfig;
}

class CheckpointTestProvider extends AiProvider {
  readonly name = CKPT_PROVIDER;
  readonly displayName = "Checkpoint Test";
  readonly isLocal = true;
  readonly supportsBrowser = true;
  readonly supportsServer = true;
  constructor(runFns?: readonly AiProviderRunFnRegistration[]) {
    super(runFns);
  }
}

describe("CacheCheckpointTask", () => {
  let warmupCalls: { session: AiSessionContext | undefined }[];

  const warmupFn: AiProviderRunFn = async (_input, _model, _signal, emit, _schema, session) => {
    warmupCalls.push({ session });
    emit({
      type: "finish",
      data: { checkpoint: session?.sessionId ?? "" },
    } as unknown as StreamEvent<TaskOutput>);
  };

  beforeEach(async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    clearCheckpointsForTesting();
    warmupCalls = [];
    const provider = new CheckpointTestProvider([
      { serves: CACHE_CHECKPOINT as Capability[], runFn: warmupFn },
    ]);
    await provider.register({ queue: { autoCreate: false } });
  });

  afterEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
  });

  it("exposes its task type and required capability", () => {
    expect(CacheCheckpointTask.type).toBe("CacheCheckpointTask");
    expect(CacheCheckpointTask.requires).toContain("cache.checkpoint");
  });

  it("warms once and outputs the minted checkpoint id", async () => {
    const out = await cacheCheckpoint({
      model: checkpointModel(),
      systemPrompt: "You are helpful.",
      tools: [{ name: "a", description: "A", inputSchema: { type: "object" } }],
    });
    expect(warmupCalls).toHaveLength(1);
    expect(out?.checkpoint).toBe(warmupCalls[0].session?.sessionId);
    const entry = getCheckpoint(out!.checkpoint);
    expect(entry?.provider).toBe(CKPT_PROVIDER);
    expect(entry?.prefix.systemPrompt).toBe("You are helpful.");
    expect(warmupCalls[0].session?.prefix?.tools).toHaveLength(1);
  });

  it("extends a parent checkpoint and supersedes it by default", async () => {
    const first = await cacheCheckpoint({
      model: checkpointModel(),
      systemPrompt: "sys",
      messages: [{ role: "user", content: [{ type: "text", text: "one" }] }],
    });
    const disposeSpy = vi.spyOn(getAiProviderRegistry(), "disposeSession");
    const second = await cacheCheckpoint({
      model: checkpointModel(),
      checkpoint: first!.checkpoint,
      messages: [{ role: "user", content: [{ type: "text", text: "two" }] }],
    });
    const entry = getCheckpoint(second!.checkpoint);
    expect(entry?.parentId).toBe(first!.checkpoint);
    expect(entry?.prefix.systemPrompt).toBe("sys");
    expect(entry?.prefix.messages).toHaveLength(2);
    expect(getCheckpoint(first!.checkpoint)).toBeUndefined();
    expect(disposeSpy).toHaveBeenCalledWith(CKPT_PROVIDER, first!.checkpoint);
  });

  it("keepParent preserves the parent entry", async () => {
    const first = await cacheCheckpoint({ model: checkpointModel(), systemPrompt: "sys" });
    const second = await cacheCheckpoint({
      model: checkpointModel(),
      checkpoint: first!.checkpoint,
      keepParent: true,
      messages: [{ role: "user", content: [{ type: "text", text: "tail" }] }],
    });
    expect(getCheckpoint(first!.checkpoint)).toBeDefined();
    expect(getCheckpoint(second!.checkpoint)?.parentId).toBe(first!.checkpoint);
  });

  it("rejects an unknown parent checkpoint", async () => {
    await expect(
      cacheCheckpoint({ model: checkpointModel(), checkpoint: "missing-ckpt" })
    ).rejects.toThrow(/unknown cache checkpoint/i);
  });

  it("rejects a provider-mismatched parent checkpoint", async () => {
    registerCheckpoint("foreign", {
      provider: "OTHER_PROVIDER",
      modelKey: "",
      prefix: {},
    });
    await expect(
      cacheCheckpoint({ model: checkpointModel(), checkpoint: "foreign" })
    ).rejects.toThrow(/provider/i);
  });
});

describe("ToolCallingTask checkpoint ports", () => {
  let toolCalls: { session: AiSessionContext | undefined }[];

  const toolUseFn: AiProviderRunFn = async (_input, _model, _signal, emit, _schema, session) => {
    toolCalls.push({ session });
    emit({ type: "text-delta", port: "text", textDelta: "done" } as any);
    emit({ type: "finish", data: { text: "", toolCalls: [] } } as any);
  };

  function toolModel(): ModelConfig {
    return {
      ...checkpointModel(),
      capabilities: ["text.generation", "tool-use", "cache.checkpoint"],
    } as unknown as ModelConfig;
  }

  const aTool = { name: "a", description: "A", inputSchema: { type: "object" as const } };

  beforeEach(async () => {
    setAiProviderRegistry(new AiProviderRegistry());
    clearCheckpointsForTesting();
    toolCalls = [];
    const provider = new CheckpointTestProvider([
      { serves: ["text.generation", "tool-use"] as Capability[], runFn: toolUseFn },
    ]);
    await provider.register({ queue: { autoCreate: false } });
  });

  it("consumes a checkpoint: session carries the id and prefix", async () => {
    registerCheckpoint("ckpt-parent", {
      provider: CKPT_PROVIDER,
      modelKey: "test:ckpt-model:v1",
      prefix: { systemPrompt: "sys", tools: [aTool], messages: [] },
    });
    const task = new ToolCallingTask();
    await task.run({ model: toolModel(), prompt: "hi", tools: [aTool], checkpoint: "ckpt-parent" });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].session?.sessionId).toBe("ckpt-parent");
    expect(toolCalls[0].session?.prefix?.systemPrompt).toBe("sys");
  });

  it("emitCheckpoint mints a new id, registers the turn, supersedes the parent", async () => {
    registerCheckpoint("ckpt-parent", {
      provider: CKPT_PROVIDER,
      modelKey: "test:ckpt-model:v1",
      prefix: { systemPrompt: "sys", tools: [aTool], messages: [] },
    });
    const task = new ToolCallingTask();
    const out = await task.run({
      model: toolModel(),
      prompt: "hi",
      tools: [aTool],
      checkpoint: "ckpt-parent",
      emitCheckpoint: true,
    });
    const emitted = (out as { checkpoint?: string }).checkpoint;
    expect(emitted).toBeTruthy();
    expect(toolCalls[0].session?.emitCheckpointId).toBe(emitted);
    expect(toolCalls[0].session?.supersedeParent).toBe(true);
    const entry = getCheckpoint(emitted!);
    expect(entry?.parentId).toBe("ckpt-parent");
    // parent superseded
    expect(getCheckpoint("ckpt-parent")).toBeUndefined();
    // new prefix = parent messages + user turn + assistant turn
    expect(entry?.prefix.messages?.at(-1)?.role).toBe("assistant");
    expect(entry?.prefix.messages?.at(-2)?.role).toBe("user");
  });

  it("keepParentCheckpoint preserves the parent", async () => {
    registerCheckpoint("ckpt-parent", {
      provider: CKPT_PROVIDER,
      modelKey: "test:ckpt-model:v1",
      prefix: { systemPrompt: "sys", tools: [aTool], messages: [] },
    });
    const task = new ToolCallingTask();
    await task.run({
      model: toolModel(),
      prompt: "hi",
      tools: [aTool],
      checkpoint: "ckpt-parent",
      emitCheckpoint: true,
      keepParentCheckpoint: true,
    });
    expect(getCheckpoint("ckpt-parent")).toBeDefined();
    expect(toolCalls[0].session?.supersedeParent).toBeUndefined();
  });

  it("unknown checkpoint fails before dispatch", async () => {
    const task = new ToolCallingTask();
    await expect(
      task.run({ model: toolModel(), prompt: "hi", tools: [aTool], checkpoint: "missing" })
    ).rejects.toThrow(/unknown cache checkpoint/i);
    expect(toolCalls).toHaveLength(0);
  });

  it("without checkpoint ports the auto-fingerprint session still applies", async () => {
    const task = new ToolCallingTask();
    await task.run({ model: toolModel(), prompt: "hi", tools: [aTool] });
    expect(toolCalls[0].session?.sessionId).toBeTruthy();
    expect(toolCalls[0].session?.prefix).toBeUndefined();
  });
});

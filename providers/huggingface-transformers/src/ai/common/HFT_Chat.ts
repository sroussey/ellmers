/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiChatProviderInput,
  AiChatProviderOutput,
  AiProviderRunFn,
  AiSessionContext,
  ChatMessage,
} from "@workglow/ai";
import type { StreamPhase } from "@workglow/task-graph";
import { renderHftPrefixPrompt } from "./HFT_CacheCheckpoint";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import type { HftPrefixRewindSession } from "./HFT_Pipeline";
import {
  deleteHftSession,
  getHftSession,
  getPipeline,
  getPipelineCacheKey,
  loadTransformersSDK,
  setHftSession,
  withHftPipelineInUse,
} from "./HFT_Pipeline";
import { createStreamingTextStreamer, createTextStreamer } from "./HFT_Streaming";
import { buildHFTMessages, mapHFTTools } from "./HFT_ToolCalling";

export function resolveHftCheckpointSystemPrompt(
  inputSystemPrompt: string | undefined,
  prefixSystemPrompt: string | undefined
): string | undefined {
  return inputSystemPrompt ?? prefixSystemPrompt;
}

/**
 * Execute one chat turn using the HuggingFace Transformers pipeline.
 *
 * Manages prefix-rewind KV-cache sessions: after each successful turn the
 * output `past_key_values` is snapshotted and stored so the next turn
 * can reconstruct a fresh `DynamicCache` that starts from the end of the
 * previous turn rather than re-encoding the full conversation history.
 *
 * @param onDelta - If provided, each decoded token piece is forwarded via
 *   this callback (streaming path). The run path passes `undefined` and
 *   relies on the streamer only for progress reporting.
 *
 * @returns The full text accumulated from the generation.
 */
async function generateTurn(
  input: AiChatProviderInput,
  model: HfTransformersOnnxModelConfig,
  sessionContext: AiSessionContext | undefined,
  emit: (event: StreamPhase) => void,
  signal: AbortSignal | undefined,
  onDelta: ((text: string) => void) | undefined
): Promise<string> {
  const generateText = await getPipeline(model, emit, {}, signal);
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const sessionId = sessionContext?.sessionId;
  const isCheckpoint = sessionContext?.prefix !== undefined;
  const hfTokenizer = generateText.tokenizer;
  const hfModel = generateText.model;

  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  // Build message list from the conversation history.
  // `input.messages` already contains the full history including the latest
  // user message when this function is called from AiChatTask.
  //
  // When starting from a cache checkpoint, the prefix's content must be part
  // of the rendered prompt (the chat's own history never contains it), and it
  // must come FIRST so the render can start byte-for-byte with the warm-up
  // rendering — the invariant prefix-rewind KV reuse relies on.
  const prefix = sessionContext?.prefix;
  const prefixPrompt = isCheckpoint ? renderHftPrefixPrompt(hfTokenizer, prefix!) : undefined;
  let messages: Array<Record<string, unknown>>;
  if (isCheckpoint) {
    // buildHFTMessages only falls back to `prompt` when the message list is
    // empty, so append a prompt-only turn explicitly — the combined list is
    // non-empty whenever the prefix carries messages.
    const chatTail: ChatMessage[] =
      input.messages && input.messages.length > 0
        ? [...input.messages]
        : input.prompt !== undefined && input.prompt !== ""
          ? [{ role: "user", content: [{ type: "text", text: String(input.prompt) }] }]
          : [];
    messages = buildHFTMessages(
      [...(prefix!.messages ?? []), ...chatTail],
      resolveHftCheckpointSystemPrompt(input.systemPrompt, prefix!.systemPrompt),
      undefined,
      undefined
    );
  } else {
    messages = buildHFTMessages(input.messages, input.systemPrompt, input.prompt, undefined);
  }

  const prompt = hfTokenizer.apply_chat_template(messages as any, {
    ...(isCheckpoint && prefix!.tools && prefix!.tools.length > 0
      ? { tools: mapHFTTools(prefix!.tools) as any }
      : {}),
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  // prefix-rewind trusts cached KV tokens positionally: only re-encode /
  // attach the prefix snapshot when the rendered prompt provably starts with
  // the warm-up rendering; otherwise fall back to a full re-encode of the
  // prompt (correct — it carries the entire prefix).
  const prefixParityOk =
    !isCheckpoint || (prefixPrompt !== undefined && prompt.startsWith(prefixPrompt));

  const inputs = hfTokenizer(prompt);
  const promptLen = inputs.input_ids.dims[1];

  // Session cache: prefix-rewind growing with the conversation.
  const modelPath = model.provider_config.model_path;
  let hftSession = sessionId ? getHftSession(sessionId) : undefined;
  let past_key_values: any = undefined;

  if (sessionId && !hftSession && isCheckpoint && prefixParityOk) {
    // Worker restarted or state evicted: re-encode the serialized prefix
    // and re-store the snapshot under the checkpoint id.
    const { DynamicCache } = await loadTransformersSDK();
    const cache = new DynamicCache();
    const prefixInputs = hfTokenizer(prefixPrompt!);
    await hfModel.generate({ ...prefixInputs, max_new_tokens: 0, past_key_values: cache });
    const baseEntries: Record<string, any> = {};
    for (const key of Object.keys(cache)) {
      baseEntries[key] = cache[key];
    }
    const restored: HftPrefixRewindSession = {
      mode: "prefix-rewind",
      baseEntries,
      baseSeqLength: cache.get_seq_length(),
      modelPath,
    };
    setHftSession(sessionId, restored);
    hftSession = restored;
  }

  if (
    hftSession?.mode === "prefix-rewind" &&
    hftSession.modelPath === modelPath &&
    prefixParityOk
  ) {
    // Reconstruct a fresh DynamicCache from the previous turn's snapshot.
    const { DynamicCache } = await loadTransformersSDK();
    past_key_values = new DynamicCache(hftSession.baseEntries);
  }

  // Accumulator used regardless of streaming mode.
  let accumulated = "";

  let streamer: any;
  if (onDelta) {
    // Streaming path: forward each decoded token piece to the caller's
    // callback and accumulate the full string for KV-cache snapshotting.
    streamer = createStreamingTextStreamer(
      hfTokenizer,
      (text) => {
        accumulated += text;
        onDelta(text);
      },
      TextStreamer
    );
  } else {
    // Non-streaming path: use progress-reporting text streamer and accumulate
    // the full text by decoding the output tensor after generation.
    streamer = createTextStreamer(
      hfTokenizer,
      (progress, message) => emit({ type: "phase", message: message ?? "", progress }),
      TextStreamer
    );
  }

  const output = (await hfModel.generate({
    ...inputs,
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    streamer,
    stopping_criteria: [stopping_criteria],
    ...(past_key_values ? { past_key_values } : {}),
  })) as any;

  // Decode only the newly generated tokens (skip the prompt).
  if (!onDelta) {
    const seqLen = output.dims[1];
    const newTokens = output.slice(0, [promptLen, seqLen], null);
    accumulated = hfTokenizer.decode(newTokens, { skip_special_tokens: true });
  }

  // Snapshot the output KV cache for the next turn. Checkpoint ids are
  // immutable: snapshot under emitCheckpointId (if any), never overwrite the
  // checkpoint id itself. An ownedSession id is the CALLER's mutable session
  // (a chat seeded from a checkpoint prefix) — keep snapshotting under it so
  // later turns rewind to the previous turn instead of re-encoding the whole
  // growing conversation; a checkpoint must never make a chat slower.
  const immutableCheckpoint = isCheckpoint && !sessionContext?.ownedSession;
  const snapshotTargetId = immutableCheckpoint ? sessionContext?.emitCheckpointId : sessionId;
  if (snapshotTargetId) {
    let outputCache: any;
    if (past_key_values) {
      // The cache was mutated in-place during generation.
      outputCache = past_key_values;
    } else if (output.past_key_values) {
      outputCache = output.past_key_values;
    }

    if (outputCache) {
      const baseEntries: Record<string, any> = {};
      for (const key of Object.keys(outputCache)) {
        baseEntries[key] = outputCache[key];
      }
      const newSession: HftPrefixRewindSession = {
        mode: "prefix-rewind",
        baseEntries,
        baseSeqLength: outputCache.get_seq_length ? outputCache.get_seq_length() : 0,
        modelPath,
      };
      setHftSession(snapshotTargetId, newSession);
    }
  }

  if (
    immutableCheckpoint &&
    sessionContext?.supersedeParent &&
    sessionId &&
    sessionContext?.emitCheckpointId
  ) {
    deleteHftSession(sessionId);
  }

  return accumulated;
}

export const HFT_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionContext) => {
  // Refcount the pipeline for the duration of a single turn — long-lived
  // conversations are not held across turns; only active inference is
  // protected from concurrent LRU eviction.
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    await generateTurn(input, model!, sessionContext, emit, signal, (piece) => {
      emit({ type: "text-delta", port: "text", textDelta: piece });
    });
    emit({ type: "finish", data: {} as AiChatProviderOutput });
  });
};

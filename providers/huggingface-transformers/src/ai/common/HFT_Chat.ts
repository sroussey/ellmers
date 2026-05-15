/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiChatProviderInput, AiChatProviderOutput, AiProviderRunFn } from "@workglow/ai";
import type { StreamPhase } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import type { HftPrefixRewindSession } from "./HFT_Pipeline";
import { getHftSession, getPipeline, loadTransformersSDK, setHftSession } from "./HFT_Pipeline";
import { createStreamingTextStreamer, createTextStreamer } from "./HFT_Streaming";
import { buildHFTMessages } from "./HFT_ToolCalling";

// ============================================================================
// Shared turn implementation
// ============================================================================

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
  sessionId: string | undefined,
  emit: (event: StreamPhase) => void,
  signal: AbortSignal | undefined,
  onDelta: ((text: string) => void) | undefined
): Promise<string> {
  const generateText = await getPipeline(model, emit, {}, signal);
  const { TextStreamer, InterruptableStoppingCriteria } = await loadTransformersSDK();

  const hfTokenizer = generateText.tokenizer;
  const hfModel = generateText.model;

  const stopping_criteria = new InterruptableStoppingCriteria();
  if (signal) {
    signal.addEventListener("abort", () => stopping_criteria.interrupt(), { once: true });
  }

  // Build message list from the conversation history.
  // `input.messages` already contains the full history including the latest
  // user message when this function is called from AiChatTask.
  const messages = buildHFTMessages(input.messages, input.systemPrompt, input.prompt, undefined);

  const prompt = hfTokenizer.apply_chat_template(messages as any, {
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  const inputs = hfTokenizer(prompt);
  const promptLen = inputs.input_ids.dims[1];

  // Session cache: prefix-rewind growing with the conversation.
  const modelPath = model.provider_config.model_path;
  let session = sessionId ? getHftSession(sessionId) : undefined;
  let past_key_values: any = undefined;

  if (session?.mode === "prefix-rewind" && session.modelPath === modelPath) {
    // Reconstruct a fresh DynamicCache from the previous turn's snapshot.
    const { DynamicCache } = await loadTransformersSDK();
    past_key_values = new DynamicCache(session.baseEntries);
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

  // Snapshot the output KV cache for the next turn.
  if (sessionId) {
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
      setHftSession(sessionId, newSession);
    }
  }

  return accumulated;
}

// ============================================================================
// Provider run function
// ============================================================================

export const HFT_Chat: AiProviderRunFn<
  AiChatProviderInput,
  AiChatProviderOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit, _outputSchema, sessionId) => {
  await generateTurn(input, model!, sessionId, emit, signal, (piece) => {
    emit({ type: "text-delta", port: "text", textDelta: piece });
  });
  emit({ type: "finish", data: {} as AiChatProviderOutput });
};

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextStreamer } from "@huggingface/transformers";
import type { StreamPhase, StreamUsage, Usage } from "@workglow/task-graph";

/** How often {@link createDecodeUsageReporter} may emit, in milliseconds. */
const USAGE_INTERVAL_MS = 250;

/** Emits both the stage label and the token snapshots. */
export type HftStreamEmit = (event: StreamPhase | StreamUsage) => void;

/**
 * Emit the prefill phase when Transformers.js hands the prompt to its
 * streamer. For decoder-only generation, `generate()` does this immediately
 * before the first model forward, so it excludes provider/model preparation
 * while still covering the complete prompt evaluation wait. Encoder-decoder
 * models may run their separate encoder before this callback.
 */
function emitPrefillOnFirstPut(
  streamer: { put(value: bigint[][]): void },
  emit: (event: StreamPhase) => void,
  onPrompt?: (tokens: number) => void
): void {
  const put = streamer.put.bind(streamer);
  let promptPending = true;
  streamer.put = (value: bigint[][]): void => {
    if (promptPending) {
      promptPending = false;
      emit({ type: "phase", message: "Prefilling", progress: undefined });
      // The first put IS the prompt, so its length is the input token count --
      // the one moment a local model can state its prompt cost, and the reason
      // input shows up before a single token has been generated.
      const tokens = value[0]?.length;
      if (typeof tokens === "number") onPrompt?.(tokens);
    }
    put(value);
  };
}

/** Reports what a local generation has spent so far. */
export interface DecodeUsageReporter {
  /** The prompt reached the model: its length is the input token count. */
  readonly onPrompt: (tokens: number) => void;
  /** One decoded piece arrived. */
  readonly onToken: () => void;
  /** Emit the final total, ignoring the throttle. */
  readonly flush: () => void;
}

/**
 * Reports a local model's token spend as {@link StreamUsage} snapshots, the
 * same channel every cloud provider reports through — so a local run shows its
 * counts wherever a cloud run does, with no per-provider special case.
 *
 * Snapshots are **cumulative**: each one restates the call's running total, so
 * a consumer replaces rather than accumulates and a dropped event costs
 * nothing. They are throttled to {@link USAGE_INTERVAL_MS} because a local model
 * decodes hundreds of tokens and an event per token would flood the consumer.
 *
 * Every decoded piece counts, including pieces a caller filters out of its own
 * output (a `<think>` block, tool markup): those are generated tokens, and a
 * count that froze while the model chewed through reasoning would understate
 * the real spend.
 *
 * A local model bills nothing, so `cached` / `cacheWrite` stay `undefined`
 * rather than a stated `0` — the provider reports no caching, which is not the
 * same as reporting that it cached nothing.
 */
export function createDecodeUsageReporter(
  emit: (event: StreamUsage) => void,
  options: {
    intervalMs?: number;
    now?: () => number;
  } = {}
): DecodeUsageReporter {
  const intervalMs = options.intervalMs ?? USAGE_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let input: number | undefined;
  let output = 0;
  let lastEmit: number | undefined;
  let lastEmitted: number | undefined;

  const snapshot = (): Usage => ({
    input,
    output,
    cached: undefined,
    cacheWrite: undefined,
    reasoning: undefined,
    total: undefined,
    extra: undefined,
  });

  const send = (at: number): void => {
    lastEmit = at;
    lastEmitted = output;
    emit({ type: "usage", usage: snapshot() });
  };

  return {
    onPrompt: (tokens: number): void => {
      input = tokens;
      send(now());
    },
    onToken: (): void => {
      output++;
      const at = now();
      if (lastEmit !== undefined && at - lastEmit < intervalMs) return;
      send(at);
    },
    flush: (): void => {
      // Nothing generated and no prompt seen: there is no spend to report, and
      // an all-undefined snapshot would claim a call happened that did not.
      if (output === 0 && input === undefined) return;
      if (lastEmitted === output) return;
      send(now());
    },
  };
}

/**
 * Creates a TextStreamer that invokes `onText` for each decoded token piece.
 * The pipeline yields tokens synchronously through the callback during
 * `model.generate(...)`, so `onText` can call `emit` directly — no queue
 * is needed between the SDK and the consumer.
 *
 * `emit` is taken (and the usage reporter wired) here rather than left to each
 * run-fn so that no streaming run-fn can ship without reporting its spend: the
 * silence is invisible in tests and only shows up as a run whose token counts
 * never appear.
 */
export function createStreamingTextStreamer(
  tokenizer: any,
  onText: (text: string) => void,
  textStreamer: typeof TextStreamer,
  emit: HftStreamEmit
) {
  const usage = createDecodeUsageReporter(emit);
  const streamer = new textStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      // Counted before the caller's own handling so a piece the caller drops
      // still advances the count, and so a throw in `onText` cannot silently
      // stop the reporting while generation continues.
      usage.onToken();
      onText(text);
    },
  });
  emitPrefillOnFirstPut(streamer, emit, usage.onPrompt);
  // The throttle can swallow the last tokens, so the final total is flushed
  // when generation ends rather than left reporting a stale count.
  const end = streamer.end.bind(streamer);
  streamer.end = (): void => {
    usage.flush();
    end();
  };
  return streamer;
}

export function createTextStreamer(
  tokenizer: any,
  updateProgress: (progress: number | undefined, message?: string, details?: any) => void,
  textStreamer: typeof TextStreamer
) {
  let count = 0;
  const streamer = new textStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      count++;
      const result = 100 * (1 - Math.exp(-0.05 * count));
      const progress = Math.round(Math.min(result, 100));
      updateProgress(progress, "Generating", { text, progress });
    },
  });
  emitPrefillOnFirstPut(streamer, (event) => updateProgress(event.progress, event.message));
  return streamer;
}

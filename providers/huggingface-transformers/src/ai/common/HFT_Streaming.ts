/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextStreamer } from "@huggingface/transformers";
import type { StreamPhase } from "@workglow/task-graph";

/** How often {@link createDecodeHeartbeat} may emit, in milliseconds. */
const HEARTBEAT_INTERVAL_MS = 250;

/**
 * Decode heartbeat: a `phase` event carrying the running token count, emitted
 * at most every {@link HEARTBEAT_INTERVAL_MS} while the model generates.
 *
 * Deltas do not drive progress. `StreamProcessor` translates only `phase`
 * events into `updateProgress`, and `StreamingAiTask` emits exactly one
 * `Generating` phase, latched on the first delta — so a local model decoding
 * for minutes renders as one static line for the whole run even though a token
 * is arriving every few hundred milliseconds.
 *
 * The count rides in the **message**, not in `progress`: a consumer that owns
 * its own percentage discards a subtask's number, so a numeric-only heartbeat
 * would be invisible in exactly the sweeps where the wait is longest. It is
 * also a count rather than a percentage because generation stops at an end
 * token, not at `max_new_tokens` — any fraction of the token cap would stall
 * near an arbitrary value and then jump, which reads as a hang.
 *
 * The returned function is called once per decoded token piece, including
 * pieces a caller filters out of its own output (a `<think>` block, tool
 * markup): those are decode work too, and a count that froze while the model
 * chewed through reasoning tokens would report a hang that is not happening.
 */
export function createDecodeHeartbeat(
  emit: (event: StreamPhase) => void,
  options: {
    label?: string;
    intervalMs?: number;
    now?: () => number;
  } = {}
): () => void {
  const label = options.label ?? "Generating";
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let count = 0;
  // Anchored at the first token rather than at construction: the streamer is
  // built before prompt formatting and pipeline warm-up, so anchoring here
  // would spend the whole first interval before a token ever arrived and fire
  // a heartbeat immediately on token one.
  let lastEmit: number | undefined;
  return () => {
    count++;
    const at = now();
    if (lastEmit === undefined) {
      // Leading edge suppressed: `StreamingAiTask` emits its own `Generating`
      // on this same first delta, so a heartbeat racing it would either be
      // overwritten or relabel the row twice at t=0.
      lastEmit = at;
      return;
    }
    if (at - lastEmit < intervalMs) return;
    lastEmit = at;
    emit({ type: "phase", message: `${label} ${count} tok`, progress: undefined });
  };
}

/**
 * Creates a TextStreamer that invokes `onText` for each decoded token piece.
 * The pipeline yields tokens synchronously through the callback during
 * `model.generate(...)`, so `onText` can call `emit` directly — no queue
 * is needed between the SDK and the consumer.
 *
 * `emit` is taken (and the heartbeat wired) here rather than left to each
 * run-fn so that no streaming run-fn can ship without decode feedback: the
 * silence is invisible in tests and only shows up as a minutes-long static
 * line against a slow local model.
 */
export function createStreamingTextStreamer(
  tokenizer: any,
  onText: (text: string) => void,
  textStreamer: typeof TextStreamer,
  emit: (event: StreamPhase) => void
) {
  const heartbeat = createDecodeHeartbeat(emit);
  return new textStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      // Counted before the caller's own handling so a piece the caller drops
      // still advances the count, and so a throw in `onText` cannot silently
      // stop the heartbeat while generation continues.
      heartbeat();
      onText(text);
    },
  });
}

export function createTextStreamer(
  tokenizer: any,
  updateProgress: (progress: number, message?: string, details?: any) => void,
  textStreamer: typeof TextStreamer
) {
  let count = 0;
  return new textStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      count++;
      const result = 100 * (1 - Math.exp(-0.05 * count));
      const progress = Math.round(Math.min(result, 100));
      updateProgress(progress, "Generating", { text, progress });
    },
  });
}

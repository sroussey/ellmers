/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextStreamer } from "@huggingface/transformers";

/**
 * Creates a TextStreamer that invokes `onText` for each decoded token piece.
 * The pipeline yields tokens synchronously through the callback during
 * `model.generate(...)`, so `onText` can call `emit` directly — no queue
 * is needed between the SDK and the consumer.
 */
export function createStreamingTextStreamer(
  tokenizer: any,
  onText: (text: string) => void,
  textStreamer: typeof TextStreamer
) {
  return new textStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: onText,
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

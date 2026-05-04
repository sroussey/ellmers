/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextStreamer } from "@huggingface/transformers";
import type { StreamEvent } from "@workglow/task-graph";

export type StreamEventQueue<T> = {
  push: (event: T) => void;
  done: () => void;
  error: (err: Error) => void;
  iterable: AsyncIterable<T>;
};

export function createStreamEventQueue<T>(): StreamEventQueue<T> {
  const buffer: T[] = [];
  let resolve: ((value: IteratorResult<T>) => void) | null = null;
  let finished = false;
  let err: Error | null = null;

  const push = (event: T) => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: event, done: false });
    } else {
      buffer.push(event);
    }
  };

  const done = () => {
    finished = true;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: undefined as any, done: true });
    }
  };

  const error = (e: Error) => {
    err = e;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: undefined as any, done: true });
    }
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (err) return Promise.reject(err);
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (finished) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise<IteratorResult<T>>((r) => {
            resolve = r;
          });
        },
      };
    },
  };

  return { push, done, error, iterable };
}

/**
 * Creates a TextStreamer that pushes StreamEvents into an async queue.
 * The pipeline runs to completion and updates the queue; the caller
 * consumes the queue as an AsyncIterable<StreamEvent>.
 */
export function createStreamingTextStreamer(
  tokenizer: any,
  queue: StreamEventQueue<StreamEvent<any>>,
  textStreamer: typeof TextStreamer
) {
  return new textStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      queue.push({ type: "text-delta", port: "text", textDelta: text });
    },
  });
}

/**
 * Create a text streamer for a given tokenizer and update progress function
 */
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

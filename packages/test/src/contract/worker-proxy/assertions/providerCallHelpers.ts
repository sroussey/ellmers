/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collectStream,
  getAiProviderRegistry,
  getGlobalModelRepository,
  textGeneration,
} from "@workglow/ai";
import type { Capability } from "@workglow/ai";
import type { StreamEvent, TaskOutput } from "@workglow/task-graph";

const TEXT_GENERATION: readonly Capability[] = ["text.generation"];

export interface CallOpts {
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface CallResult {
  readonly text: string;
}

export async function runProviderTextGeneration(
  modelId: string,
  prompt: string,
  callOpts: CallOpts
): Promise<CallResult> {
  const result = await textGeneration(
    {
      model: modelId,
      prompt,
      maxTokens: callOpts.maxTokens,
    },
    { timeout: callOpts.timeoutMs }
  );
  return { text: (result as { text?: string }).text ?? "" };
}

/**
 * Helper used by worker-proxy conformance tests to drive a streaming
 * text-generation run-fn end-to-end against the dispatched provider. Yields
 * the raw `StreamEvent` objects so callers can assert on the event sequence;
 * use {@link collectStream} when only the final output matters.
 */
export async function* streamProviderTextGeneration(
  modelId: string,
  prompt: string,
  callOpts: CallOpts
): AsyncGenerator<unknown, void, void> {
  const model = await getGlobalModelRepository().findByName(modelId);
  if (!model) throw new Error(`Model not registered: ${modelId}`);
  const registry = getAiProviderRegistry();
  const streamFn = registry.getRunFnFor(model.provider, TEXT_GENERATION);
  if (!streamFn) {
    throw new Error(`No run-fn registered for ${model.provider} serving ["text.generation"]`);
  }
  const ac = new AbortController();
  const onCallerAbort = (): void => ac.abort(callOpts.signal?.reason);
  const t = setTimeout(() => ac.abort(new Error("timeout")), callOpts.timeoutMs);
  if (callOpts.signal) {
    if (callOpts.signal.aborted) {
      clearTimeout(t);
      ac.abort(callOpts.signal.reason);
    } else {
      callOpts.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }
  // Bridge Promise+emit run-fn back to an async generator for callers that
  // want to inspect the raw event sequence. We push events into a queue and
  // yield them as they arrive.
  const queue: StreamEvent<TaskOutput>[] = [];
  let resolveNext: (() => void) | undefined;
  let done = false;
  let error: unknown;
  const emit = (e: StreamEvent<TaskOutput>): void => {
    queue.push(e);
    resolveNext?.();
    resolveNext = undefined;
  };
  const runP = streamFn(
    { prompt, maxTokens: callOpts.maxTokens },
    model,
    ac.signal,
    emit,
    undefined,
    undefined
  ).then(
    () => {
      done = true;
      resolveNext?.();
    },
    (err) => {
      error = err;
      done = true;
      resolveNext?.();
    }
  );
  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => {
        resolveNext = r;
      });
    }
  } finally {
    clearTimeout(t);
    callOpts.signal?.removeEventListener("abort", onCallerAbort);
    await runP.catch(() => {});
  }
}

// Re-export collectStream so worker-proxy tests can use it without a second import.
export { collectStream };

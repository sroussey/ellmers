/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectStream, getAiProviderRegistry, getGlobalModelRepository, textGeneration } from "@workglow/ai";
import type { Capability } from "@workglow/ai";

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
  try {
    yield* streamFn(
      { prompt, maxTokens: callOpts.maxTokens },
      model,
      ac.signal,
      undefined,
      undefined
    );
  } finally {
    clearTimeout(t);
    callOpts.signal?.removeEventListener("abort", onCallerAbort);
  }
}

// Re-export collectStream so worker-proxy tests can use it without a second import.
export { collectStream };

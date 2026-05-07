/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAiProviderRegistry, getGlobalModelRepository, textGeneration } from "@workglow/ai";

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

export async function* streamProviderTextGeneration(
  modelId: string,
  prompt: string,
  callOpts: CallOpts
): AsyncGenerator<unknown, void, void> {
  const model = await getGlobalModelRepository().findByName(modelId);
  if (!model) throw new Error(`Model not registered: ${modelId}`);
  const registry = getAiProviderRegistry();
  const streamFn = registry.getStreamFn(model.provider, "TextGenerationTask");
  if (!streamFn) {
    throw new Error(`No stream fn for ${model.provider}/TextGenerationTask`);
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

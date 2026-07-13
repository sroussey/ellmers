/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import { parsePartialJson } from "@workglow/util/worker";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  acquireContextSequence,
  getLlamaCppSdk,
  getLlamaInstance,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_StructuredGeneration_Stream: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  LlamaCppModelConfig
> = async (input, model, signal, emit) => {
  if (!model) throw new Error("Model config is required for StructuredGenerationTask.");

  await loadSdk();

  const llama = await getLlamaInstance();
  const context = await getOrCreateTextContext(model);
  const grammar = await llama.createGrammarForJsonSchema(input.outputSchema as any);

  const sequence = await acquireContextSequence(context);
  const { LlamaChatSession } = getLlamaCppSdk();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
  });

  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  let accumulatedText = "";
  const promptPromise = session
    .prompt(input.prompt as string, {
      signal,
      grammar,
      ...llamaCppSeedPromptSpread(model.provider_config),
      onTextChunk: (chunk: string) => {
        queue.push(chunk);
        notifyWaiter();
      },
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
    })
    .then(() => {
      isComplete = true;
      notifyWaiter();
    })
    .catch((err: unknown) => {
      completionError = err;
      isComplete = true;
      notifyWaiter();
    });

  try {
    while (true) {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        const partial = parsePartialJson(accumulatedText);
        if (partial !== undefined) {
          emit({
            type: "object-delta",
            port: "object",
            objectDelta: partial as Record<string, unknown>,
          });
        }
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    while (queue.length > 0) {
      const chunk = queue.shift()!;
      accumulatedText += chunk;
    }
  } finally {
    await promptPromise.catch(() => {});
    try {
      await session.dispose({ disposeSequence: false });
    } catch {}
    try {
      await sequence.dispose();
    } catch {}
  }

  if (completionError) {
    if (signal.aborted) return;
    throw completionError;
  }

  let finalObject: Record<string, unknown>;
  try {
    finalObject = JSON.parse(accumulatedText);
  } catch {
    finalObject = (parsePartialJson(accumulatedText) as Record<string, unknown>) ?? {};
  }

  emit({ type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput });
};

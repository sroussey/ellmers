/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getLlamaCppSdk,
  getLlamaInstance,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for StructuredGenerationTask.");

  await loadSdk();

  update_progress(0, "Loading model");
  const llama = await getLlamaInstance();
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Running structured generation");
  const grammar = await llama.createGrammarForJsonSchema(input.outputSchema as any);
  const sequence = context.getSequence();
  const { LlamaChatSession } = getLlamaCppSdk();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
  });

  try {
    const text = await session.prompt(input.prompt as string, {
      signal,
      grammar,
      ...llamaCppSeedPromptSpread(model.provider_config),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
    });

    let object: Record<string, unknown>;
    try {
      object = JSON.parse(text);
    } catch {
      object = {};
    }

    update_progress(100, "Structured generation complete");
    return { object };
  } finally {
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }
};

export const LlamaCpp_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  LlamaCppModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  if (!model) throw new Error("Model config is required for StructuredGenerationTask.");

  await loadSdk();

  const llama = await getLlamaInstance();
  const context = await getOrCreateTextContext(model);
  const grammar = await llama.createGrammarForJsonSchema(input.outputSchema as any);

  const sequence = context.getSequence();
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
          yield {
            type: "object-delta",
            port: "object",
            objectDelta: partial as Record<string, unknown>,
          };
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
    session.dispose({ disposeSequence: false });
    sequence.dispose();
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

  yield { type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput };
};

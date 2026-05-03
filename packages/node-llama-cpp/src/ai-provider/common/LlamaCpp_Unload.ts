/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
} from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  disposeLlamaCppSessionsForModel,
  getActualModelPath,
  llamaCppEmbeddingContexts,
  llamaCppModels,
  llamaCppTextContexts,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_Unload: AiProviderRunFn<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, _signal) => {
  if (!model) throw new Error("Model config is required for UnloadModelTask.");

  const modelPath = getActualModelPath(model);

  // Dispose any sessions tied to this model before releasing contexts
  disposeLlamaCppSessionsForModel(modelPath);

  const ctx = llamaCppTextContexts.get(modelPath);
  if (ctx) {
    await ctx.dispose();
    llamaCppTextContexts.delete(modelPath);
    update_progress(33, "Text context disposed");
  }

  const embCtx = llamaCppEmbeddingContexts.get(modelPath);
  if (embCtx) {
    await embCtx.dispose();
    llamaCppEmbeddingContexts.delete(modelPath);
    update_progress(66, "Embedding context disposed");
  }

  const cachedModel = llamaCppModels.get(modelPath);
  if (cachedModel) {
    await cachedModel.dispose();
    llamaCppModels.delete(modelPath);
    update_progress(100, "Model unloaded from memory");
  } else {
    update_progress(100, "Model was not loaded");
  }

  return { model: input.model! };
};

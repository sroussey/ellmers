/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelDownloadRemoveTaskRunInput,
  ModelDownloadRemoveTaskRunOutput,
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
  ModelDownloadRemoveTaskRunInput,
  ModelDownloadRemoveTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, _signal, emit) => {
  if (!model) throw new Error("Model config is required for ModelDownloadRemoveTask.");

  const modelPath = getActualModelPath(model);

  // Dispose any sessions tied to this model before releasing contexts
  await disposeLlamaCppSessionsForModel(modelPath);

  const ctx = llamaCppTextContexts.get(modelPath);
  if (ctx) {
    await ctx.dispose();
    llamaCppTextContexts.delete(modelPath);
  }

  const embCtx = llamaCppEmbeddingContexts.get(modelPath);
  if (embCtx) {
    await embCtx.dispose();
    llamaCppEmbeddingContexts.delete(modelPath);
  }

  const cachedModel = llamaCppModels.get(modelPath);
  if (cachedModel) {
    await cachedModel.dispose();
    llamaCppModels.delete(modelPath);
  }

  emit({ type: "finish", data: { model: input.model! } });
};

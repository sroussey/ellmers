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
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { modelTaskCache, wasm_reference_counts, wasm_tasks } from "./TFMP_Runtime";

export const TFMP_Unload: AiProviderRunFn<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  TFMPModelConfig
> = async (input, model, onProgress, _signal) => {
  const model_path = model!.provider_config.model_path;
  onProgress(10, "Unloading model");
  if (modelTaskCache.has(model_path)) {
    const cachedTasks = modelTaskCache.get(model_path)!;

    for (const cachedTask of cachedTasks) {
      const task = cachedTask.task;
      if ("close" in task && typeof task.close === "function") task.close();

      const task_engine = cachedTask.task_engine;
      const currentCount = wasm_reference_counts.get(task_engine) || 0;
      const newCount = currentCount - 1;

      if (newCount <= 0) {
        wasm_tasks.delete(task_engine);
        wasm_reference_counts.delete(task_engine);
      } else {
        wasm_reference_counts.set(task_engine, newCount);
      }
    }

    modelTaskCache.delete(model_path);
  }

  return {
    model: input.model,
  };
};

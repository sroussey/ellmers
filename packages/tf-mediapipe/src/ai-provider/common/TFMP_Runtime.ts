/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksTextSDK, loadTfmpTasksVisionSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";

export interface TFMPWasmFileset {
  readonly wasmLoaderPath: string;
  readonly wasmBinaryPath: string;
  readonly assetLoaderPath?: string;
  readonly assetBinaryPath?: string;
}

export const wasm_tasks = new Map<string, TFMPWasmFileset>();
export const wasm_reference_counts = new Map<string, number>();

type TaskConstructor = {
  createFromOptions(
    wasmFileset: TFMPWasmFileset,
    options: Record<string, unknown>
  ): Promise<TaskInstance>;
};

export type TaskInstance = {
  close(): void;
  [key: string]: any;
};

export interface CachedModelTask {
  readonly task: TaskInstance;
  readonly options: Record<string, unknown>;
  readonly task_engine: string;
}

export const modelTaskCache = new Map<string, CachedModelTask[]>();

const optionsMatch = (opts1: Record<string, unknown>, opts2: Record<string, unknown>): boolean => {
  const keys1 = Object.keys(opts1).sort();
  const keys2 = Object.keys(opts2).sort();

  if (keys1.length !== keys2.length) return false;

  return keys1.every((key) => {
    const val1 = opts1[key];
    const val2 = opts2[key];

    if (Array.isArray(val1) && Array.isArray(val2)) {
      return JSON.stringify(val1) === JSON.stringify(val2);
    }

    return val1 === val2;
  });
};

const getWasmTask = async (
  model: TFMPModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal
): Promise<TFMPWasmFileset> => {
  const task_engine = model.provider_config.task_engine;

  if (wasm_tasks.has(task_engine)) {
    return wasm_tasks.get(task_engine)!;
  }

  if (signal.aborted) {
    throw new PermanentJobError("Aborted job");
  }

  onProgress(0.1, "Loading WASM task");

  let wasmFileset: TFMPWasmFileset;

  switch (task_engine) {
    case "vision": {
      const { FilesetResolver } = await loadTfmpTasksVisionSDK();
      wasmFileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      break;
    }
    case "text": {
      const { FilesetResolver } = await loadTfmpTasksTextSDK();
      wasmFileset = await FilesetResolver.forTextTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm"
      );
      break;
    }
    case "audio": {
      const { FilesetResolver } = await loadTfmpTasksTextSDK();
      wasmFileset = await FilesetResolver.forAudioTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@latest/wasm"
      );
      break;
    }
    case "genai": {
      const { FilesetResolver } = await loadTfmpTasksTextSDK();
      wasmFileset = await FilesetResolver.forGenAiTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
      );
      break;
    }
    default:
      throw new PermanentJobError("Invalid task engine");
  }

  wasm_tasks.set(task_engine, wasmFileset);
  return wasmFileset;
};

export const getModelTask = async (
  model: TFMPModelConfig,
  options: Record<string, unknown>,
  onProgress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal,
  TaskType: TaskConstructor
): Promise<any> => {
  const model_path = model.provider_config.model_path;
  const task_engine = model.provider_config.task_engine;

  const cachedTasks = modelTaskCache.get(model_path);
  if (cachedTasks) {
    const matchedTask = cachedTasks.find((cached) => optionsMatch(cached.options, options));
    if (matchedTask) {
      return matchedTask.task;
    }
  }

  const wasmFileset = await getWasmTask(model, onProgress, signal);

  onProgress(0.2, "Creating model task");

  const task = await TaskType.createFromOptions(wasmFileset, {
    baseOptions: {
      modelAssetPath: model_path,
    },
    ...options,
  });

  const cachedTask: CachedModelTask = { task, options, task_engine };
  if (!modelTaskCache.has(model_path)) {
    modelTaskCache.set(model_path, []);
  }
  modelTaskCache.get(model_path)!.push(cachedTask);

  wasm_reference_counts.set(task_engine, (wasm_reference_counts.get(task_engine) || 0) + 1);

  return task;
};

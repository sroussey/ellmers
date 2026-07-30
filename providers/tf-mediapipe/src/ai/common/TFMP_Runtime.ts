/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";
import type { StreamPhase } from "@workglow/task-graph";
import {
  loadTfmpTasksAudioSDK,
  loadTfmpTasksGenaiSDK,
  loadTfmpTasksTextSDK,
  loadTfmpTasksVisionSDK,
} from "./TFMP_Client";
import type { TfmpDelegate } from "./TFMP_Delegate";
import { resolveTfmpDelegate } from "./TFMP_Delegate";
import { TFMPModelConfig } from "./TFMP_ModelSchema";

export interface TFMPWasmFileset {
  readonly wasmLoaderPath: string;
  readonly wasmBinaryPath: string;
  readonly assetLoaderPath?: string;
  readonly assetBinaryPath?: string;
}

export const wasm_tasks = new Map<string, TFMPWasmFileset>();
export const wasm_reference_counts = new Map<string, number>();

/**
 * Pinned WASM version for the genai engine. The genai JS↔WASM ABI moves
 * quickly and the npm dependency (^0.10.29) trails the other task packages
 * (^0.10.35), so the genai CDN assets are pinned to the bundled SDK version
 * rather than `@latest`. Keep in sync with the `@mediapipe/tasks-genai`
 * catalog entry in the root package.json.
 */
export const TFMP_GENAI_WASM_VERSION = "0.10.29";

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

const valuesMatch = (val1: unknown, val2: unknown): boolean => {
  if (val1 === val2) return true;
  if (val1 && val2 && typeof val1 === "object" && typeof val2 === "object") {
    return JSON.stringify(val1) === JSON.stringify(val2);
  }
  return false;
};

export const optionsMatch = (
  opts1: Record<string, unknown>,
  opts2: Record<string, unknown>
): boolean => {
  const keys1 = Object.keys(opts1).sort();
  const keys2 = Object.keys(opts2).sort();

  if (keys1.length !== keys2.length) return false;
  if (!keys1.every((key, i) => key === keys2[i])) return false;

  return keys1.every((key) => valuesMatch(opts1[key], opts2[key]));
};

export const getWasmTask = async (
  model: TFMPModelConfig,
  emit: (event: StreamPhase) => void,
  signal: AbortSignal
): Promise<TFMPWasmFileset> => {
  const task_engine = model.provider_config.task_engine;

  if (wasm_tasks.has(task_engine)) {
    return wasm_tasks.get(task_engine)!;
  }

  if (signal.aborted) {
    throw new PermanentJobError("Aborted job");
  }

  emit({ type: "phase", message: "Loading WASM task", progress: 0.1 });

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
      const { FilesetResolver } = await loadTfmpTasksAudioSDK();
      wasmFileset = await FilesetResolver.forAudioTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@latest/wasm"
      );
      break;
    }
    case "genai": {
      const { FilesetResolver } = await loadTfmpTasksGenaiSDK();
      wasmFileset = await FilesetResolver.forGenAiTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${TFMP_GENAI_WASM_VERSION}/wasm`
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
  emit: (event: StreamPhase) => void,
  signal: AbortSignal,
  TaskType: TaskConstructor
): Promise<any> => {
  const model_path = model.provider_config.model_path;
  const task_engine = model.provider_config.task_engine;
  const gpu = (model.provider_config as { gpu?: boolean }).gpu;

  const { baseOptions: rawCallerBase, ...rest } = options;
  const callerBase = (rawCallerBase as Record<string, unknown> | undefined) ?? {};

  // An explicit caller delegate wins over the model-level gpu flag.
  const delegate =
    (callerBase.delegate as TfmpDelegate | undefined) ?? resolveTfmpDelegate(task_engine, gpu);

  const buildOptions = (del: TfmpDelegate | undefined): Record<string, unknown> => ({
    ...rest,
    baseOptions: {
      ...callerBase,
      ...(del ? { delegate: del } : {}),
      modelAssetPath: model_path,
    },
  });

  const lookupOptions = buildOptions(delegate);

  const cachedTasks = modelTaskCache.get(model_path);
  if (cachedTasks) {
    const matchedTask = cachedTasks.find((cached) => optionsMatch(cached.options, lookupOptions));
    if (matchedTask) {
      return matchedTask.task;
    }
  }

  const wasmFileset = await getWasmTask(model, emit, signal);

  emit({ type: "phase", message: "Creating model task", progress: 0.2 });

  let task: TaskInstance;
  try {
    task = await TaskType.createFromOptions(wasmFileset, lookupOptions);
  } catch (error) {
    if (delegate !== "GPU") throw error;
    // Some contexts (headless, missing WebGL2) cannot create GPU-delegate
    // tasks; retry once on CPU rather than failing the model outright.
    emit({
      type: "phase",
      message: "GPU delegate unavailable, falling back to CPU",
      progress: 0.2,
    });
    task = await TaskType.createFromOptions(wasmFileset, buildOptions("CPU"));
  }

  // Cache under the *requested* options so the next identical request hits
  // even when creation fell back to CPU.
  const cachedTask: CachedModelTask = { task, options: lookupOptions, task_engine };
  if (!modelTaskCache.has(model_path)) {
    modelTaskCache.set(model_path, []);
  }
  modelTaskCache.get(model_path)!.push(cachedTask);

  wasm_reference_counts.set(task_engine, (wasm_reference_counts.get(task_engine) || 0) + 1);

  return task;
};

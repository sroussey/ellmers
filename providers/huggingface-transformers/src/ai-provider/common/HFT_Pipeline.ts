/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DynamicCache, PretrainedModelOptions, ProgressInfo } from "@huggingface/transformers";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";

let _transformersSdk: typeof import("@huggingface/transformers") | undefined;
let _cacheDir: string | undefined;

/**
 * Set the filesystem cache directory for downloaded transformers.js models.
 * Must be called before any model is loaded.
 */
export function setHftCacheDir(dir: string): void {
  _cacheDir = dir;
  if (_transformersSdk) {
    _transformersSdk.env.cacheDir = dir;
  }
}

export async function loadTransformersSDK() {
  if (!_transformersSdk) {
    try {
      _transformersSdk = await import("@huggingface/transformers");
      _transformersSdk.env.fetch = abortableFetch as typeof fetch;
      if (_cacheDir) {
        _transformersSdk.env.cacheDir = _cacheDir;
      }
    } catch {
      throw new Error(
        "@huggingface/transformers is required for HuggingFace Transformers tasks. Install it with: bun add @huggingface/transformers"
      );
    }
  }
  return _transformersSdk;
}

/** Per-model AbortControllers used by abortableFetch; keyed by model_path. */
const modelAbortControllers = new Map<string, AbortController>();

function combineAbortSignals(
  existingSignal: AbortSignal | null | undefined,
  modelSignal: AbortSignal | undefined
): AbortSignal | undefined {
  if (!existingSignal) {
    return modelSignal;
  }
  if (!modelSignal) {
    return existingSignal;
  }
  if (existingSignal.aborted || modelSignal.aborted) {
    return AbortSignal.abort(existingSignal.reason ?? modelSignal.reason);
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([existingSignal, modelSignal]);
  }

  const controller = new AbortController();
  const abort = (event: Event) => {
    const signal = event.target as AbortSignal;
    controller.abort(signal.reason);
  };
  existingSignal.addEventListener("abort", abort, { once: true });
  modelSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function createAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(String(reason ?? "Fetch aborted"));
}

function wrapAbortableResponse(response: Response, signal: AbortSignal | undefined): Response {
  if (!signal || !response.body) {
    return response;
  }

  const contentLengthHeader = response.headers.get("content-length");
  const expectedSize =
    contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number.parseInt(contentLengthHeader, 10)
      : undefined;
  const sourceBody = response.body;

  // Use pull-based reading to maintain backpressure. The previous start()-based
  // loop eagerly drained the source into the internal queue without waiting for
  // the consumer, which could buffer the entire response body in memory — a
  // problem for large model files (hundreds of MB to several GB).
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  let abortHandler: (() => void) | undefined;
  let loaded = 0;

  const cleanup = () => {
    if (abortHandler) {
      signal.removeEventListener("abort", abortHandler);
      abortHandler = undefined;
    }
    reader?.releaseLock();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      reader = sourceBody.getReader();
      if (signal.aborted) {
        controller.error(createAbortError(signal));
        return;
      }
      abortHandler = () => controller.error(createAbortError(signal));
      signal.addEventListener("abort", abortHandler, { once: true });
    },
    async pull(controller) {
      try {
        if (signal.aborted) {
          throw createAbortError(signal);
        }

        const { done, value } = await reader.read();
        if (done) {
          if (signal.aborted) {
            throw createAbortError(signal);
          }
          if (expectedSize !== undefined && loaded < expectedSize) {
            throw new Error(
              `Fetch ended before reading the full response body (${loaded}/${expectedSize} bytes)`
            );
          }
          cleanup();
          controller.close();
          return;
        }

        loaded += value.length;
        controller.enqueue(value);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    cancel(reason) {
      cleanup();
      return sourceBody.cancel(reason);
    },
  });

  return new Response(body, {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

function abortableFetch(url: string, options?: RequestInit): Promise<Response> {
  let modelSignal: AbortSignal | undefined;
  try {
    const pathname = new URL(url).pathname;
    for (const [modelPath, controller] of modelAbortControllers) {
      if (pathname.includes(`/${modelPath}/`)) {
        modelSignal = controller.signal;
        break;
      }
    }
  } catch {
    /* not a parseable URL, proceed without abort */
  }
  const combinedSignal = options?.signal
    ? combineAbortSignals(options.signal, modelSignal)
    : modelSignal;
  return fetch(url, { ...options, ...(combinedSignal ? { signal: combinedSignal } : {}) }).then(
    (response) => wrapAbortableResponse(response, combinedSignal)
  );
}

const pipelines = new Map<string, any>();

// ============================================================================
// Session cache for multi-turn conversations
// ============================================================================

interface HftSessionBase {
  readonly modelPath: string;
}

export interface HftPrefixRewindSession extends HftSessionBase {
  readonly mode: "prefix-rewind";
  /** Snapshot of prefix KV entries. On each call, a fresh DynamicCache is
   *  created from these entries so generation doesn't pollute the base prefix.
   *  Safe for WASM/CPU tensors; WebGPU would need cloning since update()
   *  disposes replaced GPU tensors. */
  readonly baseEntries: Record<string, any>;
  readonly baseSeqLength: number;
}

export interface HftProgressiveSession extends HftSessionBase {
  readonly mode: "progressive";
  /** Live DynamicCache that grows with the conversation. */
  readonly cache: DynamicCache;
}

export type HftSessionState = HftPrefixRewindSession | HftProgressiveSession;

const hftSessions = new Map<string, HftSessionState>();

export function getHftSession(sessionId: string): HftSessionState | undefined {
  return hftSessions.get(sessionId);
}

export function setHftSession(sessionId: string, state: HftSessionState): void {
  hftSessions.set(sessionId, state);
}

function disposeSessionResources(session: HftSessionState): void {
  if (session.mode === "progressive") {
    if (session.cache?.dispose) {
      session.cache.dispose();
    }
  } else {
    for (const tensor of Object.values(session.baseEntries)) {
      if (tensor?.location === "gpu-buffer" && typeof tensor.dispose === "function") {
        tensor.dispose();
      }
    }
  }
}

export function deleteHftSession(sessionId: string): boolean {
  const session = hftSessions.get(sessionId);
  if (session) {
    disposeSessionResources(session);
  }
  return hftSessions.delete(sessionId);
}

export function disposeHftSessionsForModel(modelPath: string): void {
  for (const [id, state] of hftSessions) {
    if (state.modelPath === modelPath) {
      disposeSessionResources(state);
      hftSessions.delete(id);
    }
  }
}

/** In-flight pipeline loads by cache key. Ensures only one load per model at a time to avoid corrupt ONNX files (Protobuf parsing failed). */
const pipelineLoadPromises = new Map<string, Promise<any>>();

/**
 * Vision/image pipeline types that require an image processor to be loaded.
 * If the processor is null after pipeline creation the model cache is incomplete
 * (e.g. `preprocessor_config.json` was not downloaded) and the load should be
 * treated as a retriable failure so the missing files are re-fetched.
 */
const IMAGE_PIPELINE_TYPES = new Set([
  "image-classification",
  "image-segmentation",
  "object-detection",
  "image-to-text",
  "image-feature-extraction",
  "zero-shot-image-classification",
  "depth-estimation",
  "mask-generation",
]);

/**
 * Error message prefix used when an image pipeline's processor failed to
 * initialize (null processor after load). The prefix is checked in
 * `AiJob.classifyProviderError()` to produce a `RetryableJobError` so the
 * queue re-downloads missing processor config files.
 */
export const HFT_NULL_PROCESSOR_PREFIX = "HFT_NULL_PROCESSOR:";

/**
 * Clear all cached pipelines
 */
export function clearPipelineCache(): void {
  pipelines.clear();
}

export function hasCachedPipeline(cacheKey: string): boolean {
  return pipelines.has(cacheKey);
}

export function removeCachedPipeline(cacheKey: string): boolean {
  return pipelines.delete(cacheKey);
}

/** True when running in a browser or Web Worker. Transformers.js only accepts device "wasm" or "webgpu" in the browser build. */
function isBrowserEnv(): boolean {
  if (typeof globalThis === "undefined") return false;
  // Main thread
  if (typeof (globalThis as any).window !== "undefined") return true;
  // Web Worker (has self but no window)
  if (typeof (globalThis as any).WorkerGlobalScope !== "undefined") return true;
  return false;
}

/**
 * Generate a cache key for a pipeline that includes all configuration options
 * that affect pipeline creation (model_path, pipeline, dtype, device)
 */
export function getPipelineCacheKey(model: HfTransformersOnnxModelConfig): string {
  const dtype = model.provider_config.dtype || "";
  const device = model.provider_config.device || "";
  const revision = model.provider_config.revision || "main";
  return `${model.provider_config.model_path}:${model.provider_config.pipeline}:${dtype}:${device}:${revision}`;
}

/**
 * Helper function to get a pipeline for a model
 * @param progressScaleMax - Maximum progress value for download phase (100 for download-only, 10 for download+run)
 *
 * Explicit `Promise<any>` return avoids TS2883 (inferred type not portable across package boundaries).
 */
export async function getPipeline(
  model: HfTransformersOnnxModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  options: PretrainedModelOptions = {},
  signal?: AbortSignal,
  progressScaleMax: number = 10
): Promise<any> {
  const cacheKey = getPipelineCacheKey(model);
  if (pipelines.has(cacheKey)) {
    getLogger().debug("HFT pipeline cache hit", { cacheKey });
    return pipelines.get(cacheKey);
  }

  // In-flight: only one load per model at a time to avoid concurrent writes to the same
  // ONNX cache path (which can yield "Protobuf parsing failed" when one process reads while another writes).
  const inFlight = pipelineLoadPromises.get(cacheKey);
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // First load failed (e.g. aborted) — fall through to retry below.
    }
    const cached = pipelines.get(cacheKey);
    if (cached) return cached;
    // Load failed for the other caller; fall through to retry (we remove from map in finally).
  }

  const loadPromise = doGetPipeline(
    model,
    onProgress,
    options,
    progressScaleMax,
    cacheKey,
    signal
  ).finally(() => {
    pipelineLoadPromises.delete(cacheKey);
  });
  pipelineLoadPromises.set(cacheKey, loadPromise);
  return loadPromise;
}

const doGetPipeline = async (
  model: HfTransformersOnnxModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  options: PretrainedModelOptions,
  progressScaleMax: number,
  cacheKey: string,
  signal?: AbortSignal
) => {
  // Throttle state for progress events
  let lastProgressTime = 0;
  type FilesByteMap = Record<string, { loaded: number; total: number }>;
  let pendingProgress: {
    progress: number;
    file: string;
    fileProgress: number;
    filesMap?: FilesByteMap;
  } | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  const THROTTLE_MS = 160;

  const buildProgressDetails = (
    file: string,
    fileProgress: number,
    filesMap?: FilesByteMap
  ): { file: string; progress: number; files?: FilesByteMap } => {
    const details: { file: string; progress: number; files?: FilesByteMap } = {
      file,
      progress: fileProgress,
    };
    if (filesMap && Object.keys(filesMap).length > 0) {
      details.files = filesMap;
    }
    return details;
  };

  /**
   * Sends a progress event, throttled to avoid flooding the worker channel.
   * Always sends first event and final (>=progressScaleMax) immediately.
   */
  const sendProgress = (
    progress: number,
    file: string,
    fileProgress: number,
    filesMap?: FilesByteMap
  ): void => {
    const now = Date.now();
    const timeSinceLastEvent = now - lastProgressTime;
    const isFirst = lastProgressTime === 0;
    const isFinal = progress >= progressScaleMax;

    if (isFirst || isFinal) {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      pendingProgress = null;
      onProgress(
        Math.round(progress),
        "Downloading model",
        buildProgressDetails(file, fileProgress, filesMap)
      );
      lastProgressTime = now;
      return;
    }

    if (timeSinceLastEvent < THROTTLE_MS) {
      pendingProgress = { progress, file, fileProgress, filesMap };
      if (!throttleTimer) {
        const timeRemaining = Math.max(1, THROTTLE_MS - timeSinceLastEvent);
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (pendingProgress) {
            const p = pendingProgress;
            onProgress(
              Math.round(p.progress),
              "Downloading model",
              buildProgressDetails(p.file, p.fileProgress, p.filesMap)
            );
            lastProgressTime = Date.now();
            pendingProgress = null;
          }
        }, timeRemaining);
      }
      return;
    }

    onProgress(
      Math.round(progress),
      "Downloading model",
      buildProgressDetails(file, fileProgress, filesMap)
    );
    lastProgressTime = now;
    pendingProgress = null;
  };

  // Get the abort signal from the signal parameter
  const abortSignal = signal;

  // Register a per-model AbortController so abortableFetch can cancel in-flight fetches
  const modelPath = model.provider_config.model_path;
  const modelController = new AbortController();
  modelAbortControllers.set(modelPath, modelController);
  if (abortSignal) {
    if (abortSignal.aborted) {
      modelController.abort();
    } else {
      abortSignal.addEventListener("abort", () => modelController.abort(), { once: true });
    }
  }

  // Use aggregate progress_total event from @huggingface/transformers v4 pipeline()
  const progressCallback = (status: ProgressInfo) => {
    if (abortSignal?.aborted) return;

    if (status.status === "progress_total") {
      const totalStatus = status;
      const scaledProgress = (totalStatus.progress * progressScaleMax) / 100;

      // Find the currently active file (one still downloading)
      let activeFile = "";
      let activeFileProgress = 0;
      const files: Record<string, { loaded: number; total: number }> | undefined =
        totalStatus.files;
      if (files) {
        for (const [file, info] of Object.entries(files)) {
          if (info.loaded < info.total) {
            activeFile = file;
            activeFileProgress = info.total > 0 ? (info.loaded / info.total) * 100 : 0;
            break;
          }
        }
        if (!activeFile) {
          const fileNames = Object.keys(files);
          if (fileNames.length > 0) {
            activeFile = fileNames[fileNames.length - 1];
            activeFileProgress = 100;
          }
        }
      }

      sendProgress(scaledProgress, activeFile, activeFileProgress, files);
    }
  };

  let device = model.provider_config.device as string | undefined;
  if (isBrowserEnv()) {
    // we must make a choice for the device in the browser
    if (device === "gpu") {
      device = "webgpu";
    }
    if (device === "cpu") {
      device = "wasm";
    }
    if (device !== "wasm" && device !== "webgpu") {
      device = "wasm";
    }
  } else {
    // we can trust the lib to make a choice for the device on the server
    if (device === "wasm" || device === "webgpu") {
      device = undefined;
    }
  }

  const dtype = model.provider_config.dtype || "";
  const pipelineOptions: PretrainedModelOptions = {
    revision: model.provider_config.revision || "main",
    ...(model.provider_config.use_external_data_format
      ? { useExternalDataFormat: model.provider_config.use_external_data_format }
      : {}),
    ...(dtype ? { dtype: dtype as any } : {}),
    ...(device ? { device: device as any } : {}),
    ...options,
    progress_callback: progressCallback,
  };

  // Check if already aborted before starting
  if (abortSignal?.aborted) {
    modelAbortControllers.delete(modelPath);
    throw new Error("Operation aborted before pipeline creation");
  }

  const pipelineType = model.provider_config.pipeline;

  const { pipeline } = await loadTransformersSDK();

  const logger = getLogger();
  const pipelineTimerLabel = `hft:pipeline:${cacheKey}`;
  logger.time(pipelineTimerLabel, { pipelineType, modelPath });

  try {
    const result = await pipeline(pipelineType, model.provider_config.model_path, pipelineOptions);

    // Flush pending throttled progress and clean up timer
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    // pendingProgress may have been set by progressCallback during the pipeline() await
    const finalPending = pendingProgress as {
      progress: number;
      file: string;
      fileProgress: number;
      filesMap?: FilesByteMap;
    } | null;
    if (finalPending) {
      onProgress(
        Math.round(finalPending.progress),
        "Downloading model",
        buildProgressDetails(finalPending.file, finalPending.fileProgress, finalPending.filesMap)
      );
      pendingProgress = null;
    }

    // Check if aborted after pipeline creation
    if (abortSignal?.aborted) {
      logger.timeEnd(pipelineTimerLabel, { status: "aborted" });
      throw new Error("Operation aborted after pipeline creation");
    }

    // For image/vision pipelines the processor must be initialized. A null processor
    // means the model cache is incomplete (e.g. preprocessor_config.json was not
    // downloaded, likely because a previous download was aborted). Throw a specific
    // error so the job queue can retry and re-fetch the missing files.
    if (IMAGE_PIPELINE_TYPES.has(pipelineType) && (result as any).processor == null) {
      throw new Error(
        `${HFT_NULL_PROCESSOR_PREFIX} Image processor not initialized for ` +
          `${pipelineType}/${modelPath}. Model cache may be incomplete.`
      );
    }

    logger.timeEnd(pipelineTimerLabel, { status: "loaded" });
    pipelines.set(cacheKey, result);
    return result;
  } catch (error: any) {
    logger.timeEnd(pipelineTimerLabel, { status: "error", error: String(error) });
    // If aborted, throw a clean abort error rather than internal stream errors.
    // Preserve processor-initialization errors so they propagate with their original message.
    if (
      !error?.message?.startsWith(HFT_NULL_PROCESSOR_PREFIX) &&
      (abortSignal?.aborted || modelController.signal.aborted)
    ) {
      throw new Error("Pipeline download aborted");
    }
    throw error;
  } finally {
    modelAbortControllers.delete(modelPath);
    const { random } = await loadTransformersSDK();
    random.seed(model.provider_config.seed ?? undefined);
  }
};

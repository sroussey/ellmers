/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";
import type {
  LlamaContext,
  LlamaEmbeddingContext,
  Llama as LlamaInstance,
  LlamaModel,
} from "node-llama-cpp";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";

type LlamaCppSDKModule = typeof import("node-llama-cpp");

let _sdk: LlamaCppSDKModule | undefined;
let _loadPromise: Promise<LlamaCppSDKModule> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadSdk(): Promise<LlamaCppSDKModule> {
  _loadPromise ??= import("node-llama-cpp")
    .then((mod) => {
      _sdk = mod;
      return mod;
    })
    .catch(() => {
      _loadPromise = undefined;
      _sdk = undefined;
      throw new Error(
        "node-llama-cpp is required for LOCAL_LLAMACPP tasks. Install it with: bun add node-llama-cpp"
      );
    });
  return _loadPromise;
}

export function getLlamaCppSdk() {
  if (!_sdk) {
    throw new Error("LlamaCpp SDK not loaded; call loadSdk() first");
  }
  return _sdk;
}

let llamaInstance: LlamaInstance | undefined;
/** @internal Used by unload task */
export const llamaCppModels = new Map<string, LlamaModel>();
/** @internal Used by unload task */
export const llamaCppTextContexts = new Map<string, LlamaContext>();
/** @internal Used by unload task */
export const llamaCppEmbeddingContexts = new Map<string, LlamaEmbeddingContext>();

/** Maps model_url (or model_path when used as URI) to the actual downloaded filesystem path. */
export const resolvedPaths = new Map<string, string>();

export interface LlamaCppSessionState {
  mode: "prefix-rewind" | "progressive";
  sequence: any; // LlamaContextSequence
  session: any; // LlamaChatSession (for progressive mode)
  modelKey: string;
}

export const llamaCppSessions = new Map<string, LlamaCppSessionState>();

export function getLlamaCppSession(sessionId: string): LlamaCppSessionState | undefined {
  return llamaCppSessions.get(sessionId);
}

export function setLlamaCppSession(sessionId: string, state: LlamaCppSessionState): void {
  llamaCppSessions.set(sessionId, state);
}

export async function deleteLlamaCppSession(sessionId: string): Promise<boolean> {
  const session = llamaCppSessions.get(sessionId);
  if (session) {
    try {
      await session.session?.dispose?.({ disposeSequence: false });
    } catch {}
    try {
      await session.sequence?.dispose?.();
    } catch {}
  }
  return llamaCppSessions.delete(sessionId);
}

/**
 * Eagerly dispose every cached chat session and its sequence, freeing the
 * underlying `LlamaContext` sequence-pool slots without tearing down the
 * shared contexts or models. Intended for use between unrelated test blocks
 * (or long-lived runtimes) where leftover sessions would otherwise exhaust
 * the per-context sequence pool.
 */
export async function releaseLlamaCppTransientSessions(): Promise<void> {
  for (const id of Array.from(llamaCppSessions.keys())) {
    await deleteLlamaCppSession(id);
  }
  llamaCppSessions.clear();
}

/**
 * Last-resort recovery: dispose the cached text `LlamaContext` for a given
 * model key (its sequences are released along with it) and drop it from the
 * cache so the next request rebuilds a fresh context. Sessions that referenced
 * the context are released first.
 *
 * `modelKey` accepts either the config key (typically `model_url`) or the
 * resolved on-disk path; both spellings are tried so callers don't have to
 * know which form ended up in the context cache.
 *
 * If `reloadModel` is true the cached `LlamaModel` is disposed as well, so the
 * next request reloads weights from disk. Use this when prior runs may have
 * leaked sequence-pool slots at the C level — disposing the context alone may
 * not be sufficient to reclaim them inside the same model lifetime.
 */
export async function recycleLlamaCppTextContext(
  modelKey: string,
  options: { readonly reloadModel?: boolean } = {}
): Promise<void> {
  await disposeLlamaCppSessionsForModel(modelKey);
  const resolved = resolvedPaths.get(modelKey);
  const candidates = resolved && resolved !== modelKey ? [modelKey, resolved] : [modelKey];
  for (const key of candidates) {
    const context = llamaCppTextContexts.get(key);
    if (context) {
      llamaCppTextContexts.delete(key);
      await (context as unknown as { dispose?: () => Promise<void> }).dispose?.().catch(() => {});
    }
  }
  if (options.reloadModel) {
    for (const key of candidates) {
      const loadedModel = llamaCppModels.get(key);
      if (loadedModel) {
        llamaCppModels.delete(key);
        await loadedModel.dispose().catch(() => {});
      }
    }
  }
}

export async function disposeLlamaCppSessionsForModel(modelKey: string): Promise<void> {
  for (const [id, state] of llamaCppSessions) {
    if (state.modelKey === modelKey) {
      try {
        await state.session?.dispose?.({ disposeSequence: false });
      } catch {}
      try {
        await state.sequence?.dispose?.();
      } catch {}
      llamaCppSessions.delete(id);
    }
  }
}

export async function getLlamaInstance(): Promise<LlamaInstance> {
  if (!llamaInstance) {
    const { getLlama } = await loadSdk();
    llamaInstance = await getLlama();
  }
  return llamaInstance;
}

export function getConfigKey(model: LlamaCppModelConfig): string {
  return model.provider_config.model_url ?? model.provider_config.model_path;
}

export function getActualModelPath(model: LlamaCppModelConfig): string {
  const key = getConfigKey(model);
  const resolved = resolvedPaths.get(key);
  return resolved ?? model.provider_config.model_path;
}

export async function getOrLoadModel(model: LlamaCppModelConfig): Promise<LlamaModel> {
  const modelPath = getActualModelPath(model);
  const cached = llamaCppModels.get(modelPath);
  if (cached) return cached;

  const llama = await getLlamaInstance();
  const config = model.provider_config;

  const loadedModel = await llama.loadModel({
    modelPath,
    ...(config.gpu_layers !== undefined && { gpuLayers: config.gpu_layers }),
  });

  llamaCppModels.set(modelPath, loadedModel);
  return loadedModel;
}

/** Spread into `LlamaChatSession.prompt` options when `provider_config.seed` is set. */
export function llamaCppSeedPromptSpread(
  provider_config: LlamaCppModelConfig["provider_config"]
): { seed: number } | Record<string, never> {
  return provider_config.seed !== undefined ? { seed: provider_config.seed } : {};
}

function detectQwenChatWrapperVariation(model: LlamaCppModelConfig): "3" | "3.5" | undefined {
  const candidates = [
    model.model_id,
    model.title,
    model.description,
    model.provider_config.model_url,
    model.provider_config.model_path,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());

  if (candidates.some((value) => /\bqwen[\s._-]?3[\s._-]?5\b/.test(value))) {
    return "3.5";
  }

  if (candidates.some((value) => /\bqwen[\s._-]?3\b/.test(value))) {
    return "3";
  }

  return undefined;
}

/** Spread into {@link LlamaChatSession} constructor when Qwen wrapper variation can be inferred. */
export function llamaCppChatSessionConstructorSpread(model: LlamaCppModelConfig) {
  const variation = detectQwenChatWrapperVariation(model);
  if (!variation) {
    return {};
  }
  const { QwenChatWrapper } = getLlamaCppSdk();
  return { chatWrapper: new QwenChatWrapper({ variation }) };
}

export async function getOrCreateTextContext(model: LlamaCppModelConfig): Promise<LlamaContext> {
  const modelPath = getActualModelPath(model);
  const cached = llamaCppTextContexts.get(modelPath);
  if (cached) return cached;

  const loadedModel = await getOrLoadModel(model);
  const config = model.provider_config;

  const context = await loadedModel.createContext({
    ...(config.context_size && { contextSize: config.context_size }),
    ...(config.flash_attention !== undefined && { flashAttention: config.flash_attention }),
  });

  llamaCppTextContexts.set(modelPath, context);
  return context;
}

export async function getOrCreateEmbeddingContext(
  model: LlamaCppModelConfig
): Promise<LlamaEmbeddingContext> {
  const modelPath = getActualModelPath(model);
  const cached = llamaCppEmbeddingContexts.get(modelPath);
  if (cached) return cached;

  const loadedModel = await getOrLoadModel(model);

  const context = await loadedModel.createEmbeddingContext();

  llamaCppEmbeddingContexts.set(modelPath, context);
  return context;
}

export async function* streamFromSession<T extends Record<string, unknown>>(
  promptFn: (onTextChunk: (chunk: string) => void) => Promise<string>,
  signal: AbortSignal
): AsyncGenerator<StreamEvent<T>> {
  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  const promptPromise = promptFn((chunk: string) => {
    queue.push(chunk);
    notifyWaiter();
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
        yield { type: "text-delta", port: "text", textDelta: queue.shift()! };
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    while (queue.length > 0) {
      yield { type: "text-delta", port: "text", textDelta: queue.shift()! };
    }
  } finally {
    await promptPromise.catch(() => {});
  }

  if (completionError) {
    if (signal.aborted) return;
    throw completionError;
  }

  yield { type: "finish", data: {} as T };
}

export async function disposeLlamaCppResources(): Promise<void> {
  // Dispose all sessions before contexts/models they reference
  for (const id of Array.from(llamaCppSessions.keys())) {
    await deleteLlamaCppSession(id);
  }

  const disposeAll = async (map: Map<string, { dispose(): Promise<void> }>) => {
    for (const resource of map.values()) {
      await resource.dispose().catch(() => {});
    }
    map.clear();
  };

  await disposeAll(llamaCppTextContexts as Map<string, { dispose(): Promise<void> }>);
  await disposeAll(llamaCppEmbeddingContexts as Map<string, { dispose(): Promise<void> }>);
  await disposeAll(llamaCppModels as Map<string, { dispose(): Promise<void> }>);

  if (llamaInstance) {
    await llamaInstance.dispose?.().catch(() => {});
    llamaInstance = undefined;
  }

  resolvedPaths.clear();
}

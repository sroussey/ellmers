/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser-safe variant of Cactus_Runtime — Node built-ins (`node:fs/promises`, `node:path`)
 * are excluded so browser bundlers do not need to resolve them.
 * Asset persistence uses the browser Cache Storage API exclusively.
 */

import { CACTUS_CACHE_NAME } from "./Cactus_Constants";
import {
  cactusAssetUrl,
  getCactusCatalogEntry,
  type CactusCatalogEntry,
} from "./Cactus_ModelCatalog";
import type { CactusModelConfig } from "./Cactus_ModelSchema";

type NeedleSdkModule = typeof import("needle-rs");
// `NeedleWasm` has a private constructor so `InstanceType<...>` cannot be used.
// Recover the instance type from the static `load` method's non-undefined return.
type NeedleEngine = NonNullable<ReturnType<NeedleSdkModule["NeedleWasm"]["load"]>>;

export interface CactusModelCacheInfo {
  readonly allCached: boolean;
  readonly file_sizes: Record<string, number> | null;
}

let _sdk: NeedleSdkModule | undefined;
let _sdkInitPromise: Promise<NeedleSdkModule> | undefined;

/** Lazily load needle-rs and run its WASM `init()` exactly once. */
export async function loadSdk(): Promise<NeedleSdkModule> {
  _sdkInitPromise ??= import("needle-rs")
    .then(async (mod) => {
      const init = (mod as unknown as { default?: () => Promise<unknown> }).default;
      if (typeof init === "function") {
        await init();
      }
      _sdk = mod;
      return mod;
    })
    .catch((err: unknown) => {
      _sdkInitPromise = undefined;
      _sdk = undefined;
      throw new Error(
        `needle-rs is required for LOCAL_CACTUS tasks. Install it with: bun add needle-rs (cause: ${String(err)})`
      );
    });
  return _sdkInitPromise;
}

export function getCactusSdk(): NeedleSdkModule {
  if (!_sdk) throw new Error("Cactus SDK not loaded; call loadSdk() first");
  return _sdk;
}

// ============================================================================
// Asset fetch + cache (browser-only: Cache Storage API)
// ============================================================================

function assetFilenames(entry: CactusCatalogEntry): string[] {
  return [entry.assets.weights, entry.assets.vocab, entry.assets.config];
}

async function getRemoteAssetSize(
  url: string,
  signal: AbortSignal | undefined
): Promise<number | undefined> {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    if (!response.ok) return undefined;
    const contentLength = response.headers.get("content-length");
    if (!contentLength) return undefined;
    const size = Number(contentLength);
    return Number.isFinite(size) ? size : undefined;
  } catch {
    return undefined;
  }
}

async function fetchAssetBytesBrowser(url: string): Promise<Uint8Array> {
  const cachesApi = (globalThis as unknown as { caches: CacheStorage }).caches;
  const cache = await cachesApi.open(CACTUS_CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) {
    return new Uint8Array(await hit.arrayBuffer());
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Cactus asset fetch failed (${resp.status}) for ${url}`);
  // Clone first — Response bodies can only be consumed once.
  await cache.put(url, resp.clone());
  return new Uint8Array(await resp.arrayBuffer());
}

export async function fetchAssetBytes(
  model: CactusModelConfig,
  filename: string
): Promise<Uint8Array> {
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);
  const url = cactusAssetUrl(entry, filename);
  return fetchAssetBytesBrowser(url);
}

// ============================================================================
// Engine cache (in-memory, per worker/process)
// ============================================================================

/** @internal Exported for tests. */
export const cactusEngines: Map<string, NeedleEngine> = new Map();
/** @internal Exported for tests. */
export const cactusConfigJson: Map<string, unknown> = new Map();
/** Tracks models whose assets have been persisted (downloaded) but not necessarily loaded. */
const cactusCachedModelIds: Set<string> = new Set();

const cactusEngineLoadsInFlight = new Map<string, Promise<NeedleEngine>>();

export async function getOrLoadEngine(model: CactusModelConfig): Promise<NeedleEngine> {
  const model_id = model.provider_config.model_id;
  const cached = cactusEngines.get(model_id);
  if (cached) return cached;

  const inFlight = cactusEngineLoadsInFlight.get(model_id);
  if (inFlight) return inFlight;

  const loadPromise = (async (): Promise<NeedleEngine> => {
    const sdk = await loadSdk();
    const entry = getCactusCatalogEntry(model_id);
    if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);

    const [weightsBytes, vocabBytes, configBytes] = await Promise.all([
      fetchAssetBytes(model, entry.assets.weights),
      fetchAssetBytes(model, entry.assets.vocab),
      fetchAssetBytes(model, entry.assets.config),
    ]);

    try {
      const text = new TextDecoder().decode(configBytes);
      cactusConfigJson.set(model_id, JSON.parse(text));
    } catch {
      cactusConfigJson.set(model_id, null);
    }

    // needle-rs `NeedleWasm.load(weights_bytes: Uint8Array, vocab_text: string)` — vocab is a string.
    const vocabText = new TextDecoder().decode(vocabBytes);
    const engine = sdk.NeedleWasm.load(weightsBytes, vocabText);
    if (!engine) {
      throw new Error(`needle-rs NeedleWasm.load returned undefined for model ${model_id}`);
    }
    cactusEngines.set(model_id, engine);
    return engine;
  })().finally(() => {
    cactusEngineLoadsInFlight.delete(model_id);
  });

  cactusEngineLoadsInFlight.set(model_id, loadPromise);
  return loadPromise;
}

export function isModelLoaded(model_id: string): boolean {
  return cactusEngines.has(model_id);
}

/** Mark a model_id as having its assets persisted in Cache Storage. */
export function markModelCached(model_id: string): void {
  cactusCachedModelIds.add(model_id);
}

/** Returns true if the model's assets have been downloaded or the engine is currently loaded. */
export function isModelCached(model_id: string): boolean {
  return cactusEngines.has(model_id) || cactusCachedModelIds.has(model_id);
}

export async function getCactusModelCacheInfo(
  _model: CactusModelConfig,
  entry: CactusCatalogEntry,
  detail: string | undefined,
  signal: AbortSignal | undefined
): Promise<CactusModelCacheInfo> {
  const cachesApi = (globalThis as unknown as { caches: CacheStorage }).caches;
  const cache = await cachesApi.open(CACTUS_CACHE_NAME);
  const filenames = assetFilenames(entry);
  const cacheHits = await Promise.all(
    filenames.map(async (filename) => {
      const url = cactusAssetUrl(entry, filename);
      const hit = await cache.match(url);
      return { filename, url, hit };
    })
  );
  const allCached = cacheHits.every(({ hit }) => Boolean(hit));

  if (detail === "files") {
    return {
      allCached,
      file_sizes: Object.fromEntries(filenames.map((filename) => [filename, 0])),
    };
  }

  if (detail !== "files_with_metadata") {
    return { allCached, file_sizes: null };
  }

  const file_sizes: Record<string, number> = {};
  await Promise.all(
    cacheHits.map(async ({ filename, url, hit }) => {
      if (hit) {
        const contentLength = hit.headers.get("content-length");
        const contentLengthSize = contentLength ? Number(contentLength) : undefined;
        if (contentLengthSize !== undefined && Number.isFinite(contentLengthSize)) {
          file_sizes[filename] = contentLengthSize;
        } else {
          file_sizes[filename] = (await hit.clone().arrayBuffer()).byteLength;
        }
        return;
      }
      const remoteSize = await getRemoteAssetSize(url, signal);
      if (remoteSize !== undefined) {
        file_sizes[filename] = remoteSize;
      }
    })
  );

  return {
    allCached,
    file_sizes: Object.keys(file_sizes).length > 0 ? file_sizes : null,
  };
}

// ============================================================================
// Sessions (no-op — needle-rs is stateless across calls)
// ============================================================================

/** @internal Exported for tests. */
export const cactusSessions: Map<string, Record<string, never>> = new Map();

export async function deleteCactusSession(id: string): Promise<boolean> {
  return cactusSessions.delete(id);
}

// ============================================================================
// Eviction
// ============================================================================

async function removeBrowserCacheEntries(entry: CactusCatalogEntry): Promise<void> {
  const cachesApi = (globalThis as unknown as { caches: CacheStorage }).caches;
  const cache = await cachesApi.open(CACTUS_CACHE_NAME);
  for (const filename of [entry.assets.weights, entry.assets.vocab, entry.assets.config]) {
    const url = cactusAssetUrl(entry, filename);
    try {
      await cache.delete(url);
    } catch {
      /* ignore */
    }
  }
}

function disposeCactusEngine(model_id: string): void {
  const engine = cactusEngines.get(model_id);
  if (engine) {
    try {
      (engine as unknown as { free?: () => void }).free?.();
    } catch {
      /* best effort */
    }
  }
  cactusEngines.delete(model_id);
  cactusConfigJson.delete(model_id);
  cactusCachedModelIds.delete(model_id);
}

export async function removeCachedAssets(model: CactusModelConfig): Promise<void> {
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) return;
  await removeBrowserCacheEntries(entry);
  disposeCactusEngine(model_id);
}

/** Best-effort cleanup on shutdown. */
export async function disposeCactusResources(): Promise<void> {
  for (const id of Array.from(cactusEngines.keys())) {
    disposeCactusEngine(id);
  }
  cactusEngines.clear();
  cactusConfigJson.clear();
  cactusCachedModelIds.clear();
  cactusSessions.clear();
}

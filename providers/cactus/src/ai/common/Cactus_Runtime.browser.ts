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
import { CactusIntegrityError, verifySha256 } from "./Cactus_Integrity";
import {
  assetSpecsOf,
  cactusAssetUrl,
  type CactusAssetSpec,
  type CactusCatalogEntry,
  getCactusCatalogEntry,
} from "./Cactus_ModelCatalog";
import type { CactusModelConfig } from "./Cactus_ModelSchema";
import { getCactusSessions, getRuntime } from "./Cactus_RuntimeState";

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
  return assetSpecsOf(entry).map((s) => s.filename);
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

async function fetchAssetBytesBrowser(
  url: string,
  spec: CactusAssetSpec
): Promise<Uint8Array> {
  const cachesApi = (globalThis as unknown as { caches: CacheStorage }).caches;
  const cache = await cachesApi.open(CACTUS_CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    try {
      await verifySha256(bytes, spec.sha256, { url, filename: spec.filename });
      return bytes;
    } catch (err) {
      if (err instanceof CactusIntegrityError) {
        try {
          await cache.delete(url);
        } catch {
          /* best effort */
        }
      } else {
        throw err;
      }
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Cactus asset fetch failed (${resp.status}) for ${url}`);
  const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
  const ab = await resp.arrayBuffer();
  const bytes = new Uint8Array(ab);
  if (spec.size > 0 && bytes.byteLength !== spec.size) {
    throw new CactusIntegrityError({
      url,
      filename: spec.filename,
      expected: `${spec.size} bytes`,
      actual: `${bytes.byteLength} bytes`,
    });
  }
  // Verify BEFORE storing — never persist unverified bytes to the cache.
  await verifySha256(bytes, spec.sha256, { url, filename: spec.filename });
  const headers = new Headers({
    "content-type": contentType,
    "content-length": String(bytes.byteLength),
  });
  await cache.put(url, new Response(bytes, { headers }));
  return bytes;
}

export async function fetchAssetBytes(
  model: CactusModelConfig,
  specOrFilename: CactusAssetSpec | string
): Promise<Uint8Array> {
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);
  const spec = resolveAssetSpec(entry, specOrFilename);
  const url = cactusAssetUrl(entry, spec.filename);
  return fetchAssetBytesBrowser(url, spec);
}

function resolveAssetSpec(
  entry: CactusCatalogEntry,
  specOrFilename: CactusAssetSpec | string
): CactusAssetSpec {
  if (typeof specOrFilename !== "string") return specOrFilename;
  const found = assetSpecsOf(entry).find((s) => s.filename === specOrFilename);
  if (!found) {
    throw new Error(
      `No asset spec for filename ${JSON.stringify(specOrFilename)} in catalog entry ${entry.model_id}`
    );
  }
  return found;
}

// ============================================================================
// Engine cache (in-memory, per worker/process)
//
// All Maps/Sets live on a globalThis-keyed singleton (see Cactus_RuntimeState).
// This ensures the `./ai` and `./ai-runtime` bundles — each compiled separately —
// share state. Callers should never store these references in module scope.
// ============================================================================

export async function getOrLoadEngine(model: CactusModelConfig): Promise<NeedleEngine> {
  const state = getRuntime();
  const model_id = model.provider_config.model_id;
  const cached = state.engines.get(model_id) as NeedleEngine | undefined;
  if (cached) return cached;

  const inFlight = state.engineLoadsInFlight.get(model_id) as
    | Promise<NeedleEngine>
    | undefined;
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
      state.configJson.set(model_id, JSON.parse(text));
    } catch {
      state.configJson.set(model_id, null);
    }

    // needle-rs `NeedleWasm.load(weights_bytes: Uint8Array, vocab_text: string)` — vocab is a string.
    const vocabText = new TextDecoder().decode(vocabBytes);
    const engine = sdk.NeedleWasm.load(weightsBytes, vocabText);
    if (!engine) {
      throw new Error(`needle-rs NeedleWasm.load returned undefined for model ${model_id}`);
    }
    state.engines.set(model_id, engine);
    return engine;
  })().finally(() => {
    state.engineLoadsInFlight.delete(model_id);
  });

  state.engineLoadsInFlight.set(model_id, loadPromise);
  return loadPromise;
}

export function isModelLoaded(model_id: string): boolean {
  return getRuntime().engines.has(model_id);
}

/** Mark a model_id as having its assets persisted in Cache Storage. */
export function markModelCached(model_id: string): void {
  getRuntime().cachedModelIds.add(model_id);
}

/** Returns true if the model's assets have been downloaded or the engine is currently loaded. */
export function isModelCached(model_id: string): boolean {
  const state = getRuntime();
  return state.engines.has(model_id) || state.cachedModelIds.has(model_id);
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

export async function deleteCactusSession(id: string): Promise<boolean> {
  return getCactusSessions().delete(id);
}

// ============================================================================
// Eviction
// ============================================================================

async function removeBrowserCacheEntries(entry: CactusCatalogEntry): Promise<void> {
  const cachesApi = (globalThis as unknown as { caches: CacheStorage }).caches;
  const cache = await cachesApi.open(CACTUS_CACHE_NAME);
  for (const filename of assetFilenames(entry)) {
    const url = cactusAssetUrl(entry, filename);
    try {
      await cache.delete(url);
    } catch {
      /* ignore */
    }
  }
}

function disposeCactusEngine(model_id: string): void {
  const state = getRuntime();
  const engine = state.engines.get(model_id);
  if (engine) {
    try {
      engine.free?.();
    } catch {
      /* best effort */
    }
  }
  state.engines.delete(model_id);
  state.configJson.delete(model_id);
  state.cachedModelIds.delete(model_id);
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
  const state = getRuntime();
  for (const id of Array.from(state.engines.keys())) {
    disposeCactusEngine(id);
  }
  state.engines.clear();
  state.configJson.clear();
  state.cachedModelIds.clear();
  state.sessions.clear();
}

// ============================================================================
// Legacy re-exports for callers that imported the maps/sets directly.
//
// Prefer the accessor form (`getCactusEngines()`, etc.) so that
// `__resetRuntimeForTests()` produces fresh state.
// ============================================================================

export {
  getCactusCachedModelIds,
  getCactusConfigJson,
  getCactusEngineLoadsInFlight,
  getCactusEngines,
  getCactusSessions,
} from "./Cactus_RuntimeState";

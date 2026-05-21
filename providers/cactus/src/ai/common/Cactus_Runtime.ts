/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CACTUS_CACHE_NAME, CACTUS_DEFAULT_MODELS_DIR } from "./Cactus_Constants";
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
// Asset fetch + cache
// ============================================================================

function hasBrowserCacheStorage(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "caches" in globalThis &&
    typeof (globalThis as unknown as { caches?: CacheStorage }).caches?.open === "function"
  );
}

function modelsDirOf(model: CactusModelConfig): string {
  return model.provider_config.models_dir ?? CACTUS_DEFAULT_MODELS_DIR;
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

async function fetchAssetBytesNode(
  url: string,
  models_dir: string,
  model_id: string,
  filename: string
): Promise<Uint8Array> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve(models_dir, model_id);
  const filePath = path.join(dir, filename);
  try {
    const buf = await fs.readFile(filePath);
    return new Uint8Array(buf);
  } catch {
    // fall through to fetch
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Cactus asset fetch failed (${resp.status}) for ${url}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, bytes);
  await fs.rename(tmpPath, filePath);
  return bytes;
}

export async function fetchAssetBytes(
  model: CactusModelConfig,
  filename: string
): Promise<Uint8Array> {
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);
  const url = cactusAssetUrl(entry, filename);
  if (hasBrowserCacheStorage()) {
    return fetchAssetBytesBrowser(url);
  }
  return fetchAssetBytesNode(url, modelsDirOf(model), model_id, filename);
}

// ============================================================================
// Engine cache (in-memory, per worker/process)
// ============================================================================

/** @internal Exported for tests. */
export const cactusEngines: Map<string, NeedleEngine> = new Map();
/** @internal Exported for tests. */
export const cactusConfigJson: Map<string, unknown> = new Map();

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
  if (!hasBrowserCacheStorage()) return;
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

async function removeNodeCacheDir(model: CactusModelConfig, model_id: string): Promise<void> {
  if (hasBrowserCacheStorage()) return;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve(modelsDirOf(model), model_id);
  await fs.rm(dir, { recursive: true, force: true });
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
}

export async function removeCachedAssets(model: CactusModelConfig): Promise<void> {
  const model_id = model.provider_config.model_id;
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) return;
  await Promise.all([removeBrowserCacheEntries(entry), removeNodeCacheDir(model, model_id)]);
  disposeCactusEngine(model_id);
}

/** Best-effort cleanup on shutdown. */
export async function disposeCactusResources(): Promise<void> {
  for (const id of Array.from(cactusEngines.keys())) {
    disposeCactusEngine(id);
  }
  cactusEngines.clear();
  cactusConfigJson.clear();
  cactusSessions.clear();
}

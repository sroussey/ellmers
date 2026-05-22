/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CACTUS_CACHE_NAME, CACTUS_DEFAULT_MODELS_DIR } from "./Cactus_Constants";
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

// ============================================================================
// Path-safety allowlists (defense-in-depth)
//
// `model_id` originates from user-supplied `provider_config.model_id` and
// `filename` originates from the (effectively trusted) catalog. The catalog
// lookup in `getCactusCatalogEntry` already restricts `model_id` to known
// values, but static analyzers (CodeQL) cannot see through that lookup, so
// we re-enforce explicit character allowlists at every filesystem entry
// point. Both regexes reject path separators, `..`, NUL, and any other
// shell/path-special characters.
// ============================================================================

const MODEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILENAME_RE = /^[A-Za-z0-9_.-]+$/;

function assertSafeModelId(model_id: string): void {
  if (typeof model_id !== "string" || !MODEL_ID_RE.test(model_id)) {
    throw new Error(
      `Invalid Cactus model_id ${JSON.stringify(model_id)}: ` +
        `must match ${MODEL_ID_RE} (alphanumeric, underscore, hyphen; 1-64 chars).`
    );
  }
}

function assertSafeFilename(filename: string): void {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.length > 255 ||
    filename === "." ||
    filename === ".." ||
    !FILENAME_RE.test(filename)
  ) {
    throw new Error(
      `Invalid Cactus asset filename ${JSON.stringify(filename)}: ` +
        `must match ${FILENAME_RE} (no path separators, no '..').`
    );
  }
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

function resolveModelDir(models_dir: string, model_id: string): string {
  assertSafeModelId(model_id);
  return models_dir.startsWith("~/")
    ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", models_dir.slice(2), model_id)
    : path.resolve(models_dir, model_id);
}

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

async function getNodeAssetCacheInfo(
  model: CactusModelConfig,
  entry: CactusCatalogEntry,
  detail: string | undefined,
  signal: AbortSignal | undefined
): Promise<CactusModelCacheInfo> {
  const filenames = assetFilenames(entry);
  const resolvedDir = resolveModelDir(modelsDirOf(model), entry.model_id);
  const stats = await Promise.all(
    filenames.map(async (filename) => {
      assertSafeFilename(filename);
      try {
        const stat = await fs.stat(path.join(resolvedDir, filename));
        return { filename, size: stat.size, cached: true };
      } catch {
        return { filename, size: undefined, cached: false };
      }
    })
  );
  const allCached = stats.every((stat) => stat.cached);

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
    stats.map(async (stat) => {
      if (stat.size !== undefined) {
        file_sizes[stat.filename] = stat.size;
        return;
      }
      const remoteSize = await getRemoteAssetSize(cactusAssetUrl(entry, stat.filename), signal);
      if (remoteSize !== undefined) {
        file_sizes[stat.filename] = remoteSize;
      }
    })
  );

  return {
    allCached,
    file_sizes: Object.keys(file_sizes).length > 0 ? file_sizes : null,
  };
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
        // Cached bytes are corrupt / stale — evict and refetch.
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

async function fetchAssetBytesNode(
  url: string,
  models_dir: string,
  model_id: string,
  spec: CactusAssetSpec
): Promise<Uint8Array> {
  assertSafeModelId(model_id);
  assertSafeFilename(spec.filename);
  const resolvedDir = resolveModelDir(models_dir, model_id);
  const filePath = path.join(resolvedDir, spec.filename);
  try {
    const buf = await fs.readFile(filePath);
    const bytes = new Uint8Array(buf);
    try {
      await verifySha256(bytes, spec.sha256, { url: `file:${filePath}`, filename: spec.filename });
      return bytes;
    } catch (err) {
      if (err instanceof CactusIntegrityError) {
        // On-disk asset is corrupt; evict and fall through to network.
        await fs.unlink(filePath).catch(() => {});
      } else {
        throw err;
      }
    }
  } catch (err) {
    // ENOENT or sibling read errors fall through to fetch.
    if (err instanceof CactusIntegrityError) {
      throw err; // unreachable, handled above
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Cactus asset fetch failed (${resp.status}) for ${url}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (spec.size > 0 && bytes.byteLength !== spec.size) {
    throw new CactusIntegrityError({
      url,
      filename: spec.filename,
      expected: `${spec.size} bytes`,
      actual: `${bytes.byteLength} bytes`,
    });
  }
  // Verify BEFORE writing the tmp file — never atomically promote unverified bytes.
  await verifySha256(bytes, spec.sha256, { url, filename: spec.filename });
  await fs.mkdir(resolvedDir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
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
  if (hasBrowserCacheStorage()) {
    return fetchAssetBytesBrowser(url, spec);
  }
  return fetchAssetBytesNode(url, modelsDirOf(model), model_id, spec);
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

/** Mark a model_id as having its assets persisted on disk / in Cache Storage. */
export function markModelCached(model_id: string): void {
  getRuntime().cachedModelIds.add(model_id);
}

/** Returns true if the model's assets have been downloaded or the engine is currently loaded. */
export function isModelCached(model_id: string): boolean {
  const state = getRuntime();
  return state.engines.has(model_id) || state.cachedModelIds.has(model_id);
}

export async function getCactusModelCacheInfo(
  model: CactusModelConfig,
  entry: CactusCatalogEntry,
  detail: string | undefined,
  signal: AbortSignal | undefined
): Promise<CactusModelCacheInfo> {
  if (hasBrowserCacheStorage()) {
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

  return getNodeAssetCacheInfo(model, entry, detail, signal);
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
  if (!hasBrowserCacheStorage()) return;
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

async function removeNodeCacheDir(model: CactusModelConfig, model_id: string): Promise<void> {
  if (hasBrowserCacheStorage()) return;
  assertSafeModelId(model_id);
  const models_dir = modelsDirOf(model);
  const resolvedDir = resolveModelDir(models_dir, model_id);
  await fs.rm(resolvedDir, { recursive: true, force: true });
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
  await Promise.all([removeBrowserCacheEntries(entry), removeNodeCacheDir(model, model_id)]);
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

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
import { loadCactusEngine, type NeedleEngine, type NeedleSdkModule } from "./Cactus_LoadEngine";
import {
  assetSpecsOf,
  cactusAssetUrl,
  getCactusCatalogEntry,
  type CactusAssetSpec,
  type CactusCatalogEntry,
} from "./Cactus_ModelCatalog";
import type { CactusModelConfig } from "./Cactus_ModelSchema";

export interface CactusModelCacheInfo {
  readonly allCached: boolean;
  readonly file_sizes: Record<string, number> | null;
}

// ============================================================================
// Path-safety allowlists (defense-in-depth, mirror of Cactus_Runtime.ts)
//
// The browser variant does not touch the filesystem, but applying the same
// validation keeps both code paths in sync, hardens cache-key inputs, and
// silences static analyzers that flag any use of user-supplied identifiers
// in URL/path-shaped strings.
// ============================================================================

const MODEL_ID_RE = /^[\w-]{1,64}$/;
const FILENAME_RE = /^[\w.-]+$/;
// Match the Node variant's limit so an asset that validates here also
// validates there. The Node atomic-write path writes to `${filename}.tmp`
// before renaming, so the source filename must leave room for that suffix
// (most filesystems cap a path component at 255 bytes).
const MAX_FILENAME_LEN = 251;

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
    filename.length > MAX_FILENAME_LEN ||
    filename === "." ||
    filename === ".." ||
    !FILENAME_RE.test(filename)
  ) {
    throw new Error(
      `Invalid Cactus asset filename ${JSON.stringify(filename)}: ` +
        `must match ${FILENAME_RE} (no path separators, no '..'), 1-${MAX_FILENAME_LEN} chars.`
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
  model_id: string,
  spec: CactusAssetSpec
): Promise<Uint8Array> {
  // Defense-in-depth: validate model_id at every cache call site (not only
  // at the public entry). Mirrors `fetchAssetBytesNode`, which re-asserts
  // `assertSafeModelId` even though `fetchAssetBytes` already calls it. A
  // future refactor that bypasses the public entry must not be able to slip
  // a hostile model_id past this check.
  assertSafeModelId(model_id);
  assertSafeFilename(spec.filename);
  const cachesApi = (globalThis as unknown as { caches: CacheStorage }).caches;
  const cache = await cachesApi.open(CACTUS_CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    try {
      // Cheap pre-check: a wrong-size cached entry cannot match the catalog.
      // Throwing CactusIntegrityError here flows through the same catch
      // branch that deletes the cache entry and falls through to refetch —
      // so size and hash mismatches are handled uniformly.
      if (spec.size > 0 && bytes.byteLength !== spec.size) {
        throw new CactusIntegrityError({
          url,
          filename: spec.filename,
          expected: `${spec.size} bytes`,
          actual: `${bytes.byteLength} bytes`,
        });
      }
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
  assertSafeModelId(model_id);
  const entry = getCactusCatalogEntry(model_id);
  if (!entry) throw new Error(`Unknown Cactus model_id: ${model_id}`);
  const spec = resolveAssetSpec(entry, specOrFilename);
  const url = cactusAssetUrl(entry, spec.filename);
  return fetchAssetBytesBrowser(url, model_id, spec);
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

    const specs = assetSpecsOf(entry);
    const blobs = await Promise.all(specs.map((spec) => fetchAssetBytes(model, spec)));
    const files = Object.fromEntries(specs.map((spec, i) => [spec.filename, blobs[i]!]));

    if (entry.generation === 1) {
      try {
        const text = new TextDecoder().decode(files[entry.assets.config.filename]);
        cactusConfigJson.set(model_id, JSON.parse(text));
      } catch {
        cactusConfigJson.set(model_id, null);
      }
    } else {
      cactusConfigJson.set(model_id, null);
    }

    const engine = loadCactusEngine(sdk, entry, files);
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

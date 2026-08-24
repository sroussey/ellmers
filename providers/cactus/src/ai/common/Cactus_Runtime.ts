/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CACTUS_CACHE_NAME, CACTUS_DEFAULT_MODELS_DIR } from "./Cactus_Constants";
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

const MODEL_ID_RE = /^[\w-]{1,64}$/;
const FILENAME_RE = /^[\w.-]+$/;
// Most filesystems (ext4, APFS, NTFS) cap a single path component at 255
// bytes. The Node atomic-write path writes to `${filename}.tmp` (4 chars)
// before renaming, so the source filename must leave room for that suffix.
// Apply the same limit in the browser variant for cross-platform parity.
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
        `must match ${FILENAME_RE} (no path separators, no '..'), 1-${MAX_FILENAME_LEN} chars ` +
        `(reserves 4 chars for the '.tmp' suffix used by atomic writes).`
    );
  }
}

function isRecoverableCacheReadError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("code" in err)) {
    return false;
  }
  const code = (err as { readonly code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
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
  const models_dir = modelsDirOf(model);
  const model_id = entry.model_id;
  assertSafeModelId(model_id);
  // Compute the resolved model dir inline so CodeQL's js/path-injection
  // query can trace the sanitizer locally.
  const safeRoot = models_dir.startsWith("~/")
    ? path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".", models_dir.slice(2))
    : path.resolve(models_dir);
  const resolvedDir = path.resolve(safeRoot, model_id);
  {
    const rel = path.relative(safeRoot, resolvedDir);
    if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
      throw new Error(
        `Path escape detected: ${JSON.stringify(resolvedDir)} is not within ${JSON.stringify(safeRoot)}`
      );
    }
  }
  const stats = await Promise.all(
    filenames.map(async (filename) => {
      assertSafeFilename(filename);
      // Inline sanitizer at the fs call site.
      const target = path.resolve(resolvedDir, filename);
      const rel = path.relative(resolvedDir, target);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        return { filename, size: undefined, cached: false };
      }
      try {
        const stat = await fs.stat(target);
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

async function fetchAssetBytesBrowser(url: string, spec: CactusAssetSpec): Promise<Uint8Array> {
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
  // Compute the resolved model dir inline so CodeQL's js/path-injection
  // query can trace the sanitizer locally.
  const safeRoot = models_dir.startsWith("~/")
    ? path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".", models_dir.slice(2))
    : path.resolve(models_dir);
  const resolvedDir = path.resolve(safeRoot, model_id);
  {
    const rel = path.relative(safeRoot, resolvedDir);
    if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
      throw new Error(
        `Path escape detected: ${JSON.stringify(resolvedDir)} is not within ${JSON.stringify(safeRoot)}`
      );
    }
  }
  // Used for the error-context URL only — not for any fs.* call (those
  // recompute path.resolve locally so CodeQL sees the inline sanitizer).
  const filePath = path.resolve(resolvedDir, spec.filename);
  {
    const rel = path.relative(resolvedDir, filePath);
    if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
      throw new Error(
        `Path escape detected: ${JSON.stringify(filePath)} is not within ${JSON.stringify(resolvedDir)}`
      );
    }
  }
  try {
    // Re-resolve at the call site so CodeQL sees the sanitizer locally.
    const requestedReadPath = path.resolve(resolvedDir, spec.filename);
    {
      const rel = path.relative(resolvedDir, requestedReadPath);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new Error(
          `Path escape detected: ${JSON.stringify(requestedReadPath)} is not within ${JSON.stringify(resolvedDir)}`
        );
      }
    }
    const realSafeRoot = realpathSync(safeRoot);
    const realResolvedDir = realpathSync(resolvedDir);
    {
      const rel = path.relative(realSafeRoot, realResolvedDir);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new Error(
          `Path escape detected: ${JSON.stringify(realResolvedDir)} is not within ${JSON.stringify(realSafeRoot)}`
        );
      }
    }
    const readPath = realpathSync(path.resolve(realResolvedDir, spec.filename));
    {
      const rel = path.relative(realResolvedDir, readPath);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new Error(
          `Path escape detected: ${JSON.stringify(readPath)} is not within ${JSON.stringify(realResolvedDir)}`
        );
      }
    }
    const buf = await fs.readFile(readPath);
    const bytes = new Uint8Array(buf);
    try {
      // Cheap pre-check: a wrong-size cached file cannot match the catalog.
      // Throwing CactusIntegrityError here flows through the same catch
      // branch that unlinks and falls through to the network refetch
      // path — so size and hash mismatches are handled uniformly.
      if (spec.size > 0 && bytes.byteLength !== spec.size) {
        throw new CactusIntegrityError({
          url: `file:${filePath}`,
          filename: spec.filename,
          expected: `${spec.size} bytes`,
          actual: `${bytes.byteLength} bytes`,
        });
      }
      await verifySha256(bytes, spec.sha256, { url: `file:${filePath}`, filename: spec.filename });
      return bytes;
    } catch (err) {
      if (err instanceof CactusIntegrityError) {
        // On-disk asset is corrupt; evict and fall through to network.
        const unlinkPath = path.resolve(resolvedDir, spec.filename);
        const rel = path.relative(resolvedDir, unlinkPath);
        if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
          throw new Error(
            `Path escape detected: ${JSON.stringify(unlinkPath)} is not within ${JSON.stringify(resolvedDir)}`
          );
        }
        await fs.unlink(unlinkPath).catch(() => {});
      } else {
        throw err;
      }
    }
  } catch (err) {
    // Only ENOENT (cache miss) should fall through to the network refetch.
    // A `CactusIntegrityError` re-throws as today — except it's actually
    // handled by the inner catch above (which unlinks and falls through to
    // network), so it never reaches here in practice. Any *other* fs error
    // (EACCES, EIO, EISDIR, EMFILE, …) means we couldn't authoritatively
    // determine cache contents; silently refetching would mask real
    // filesystem problems. Wrap with a clear message and rethrow so the
    // caller sees the underlying cause.
    if (err instanceof CactusIntegrityError) {
      throw err; // unreachable, handled above
    }
    if (!isRecoverableCacheReadError(err)) {
      throw err;
    }
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      throw new Error(`Cactus cache read failed for ${spec.filename} (code=${code ?? "unknown"})`, {
        cause: err,
      });
    }
    // ENOENT — file not cached; fall through to network.
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
  // Inline sanitizer for the mkdir target.
  const mkdirTarget = path.resolve(safeRoot, model_id);
  {
    const rel = path.relative(safeRoot, mkdirTarget);
    if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
      throw new Error(
        `Path escape detected: ${JSON.stringify(mkdirTarget)} is not within ${JSON.stringify(safeRoot)}`
      );
    }
  }
  await fs.mkdir(mkdirTarget, { recursive: true });
  // Atomic write: write to a sibling `.tmp` path, then rename. Each fs
  // call below recomputes its path via path.resolve so CodeQL sees the
  // inline sanitizer at every call site.
  try {
    const writeTarget = path.resolve(resolvedDir, `${spec.filename}.tmp`);
    {
      const rel = path.relative(resolvedDir, writeTarget);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new Error(
          `Path escape detected: ${JSON.stringify(writeTarget)} is not within ${JSON.stringify(resolvedDir)}`
        );
      }
    }
    await fs.writeFile(writeTarget, bytes);
    const renameFrom = path.resolve(resolvedDir, `${spec.filename}.tmp`);
    {
      const rel = path.relative(resolvedDir, renameFrom);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new Error(
          `Path escape detected: ${JSON.stringify(renameFrom)} is not within ${JSON.stringify(resolvedDir)}`
        );
      }
    }
    const renameTo = path.resolve(resolvedDir, spec.filename);
    {
      const rel = path.relative(resolvedDir, renameTo);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new Error(
          `Path escape detected: ${JSON.stringify(renameTo)} is not within ${JSON.stringify(resolvedDir)}`
        );
      }
    }
    await fs.rename(renameFrom, renameTo);
  } catch (err) {
    const cleanupTarget = path.resolve(resolvedDir, `${spec.filename}.tmp`);
    {
      const rel = path.relative(resolvedDir, cleanupTarget);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw err;
      }
    }
    await fs.unlink(cleanupTarget).catch(() => {});
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

    if ("config" in entry.assets) {
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

/** Mark a model_id as having its assets persisted on disk / in Cache Storage. */
export function markModelCached(model_id: string): void {
  cactusCachedModelIds.add(model_id);
}

/** Returns true if the model's assets have been downloaded or the engine is currently loaded. */
export function isModelCached(model_id: string): boolean {
  return cactusEngines.has(model_id) || cactusCachedModelIds.has(model_id);
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
  // Compute the resolved model dir inline so CodeQL's js/path-injection
  // query can trace the sanitizer locally.
  const safeRoot = models_dir.startsWith("~/")
    ? path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".", models_dir.slice(2))
    : path.resolve(models_dir);
  const resolvedDir = path.resolve(safeRoot, model_id);
  {
    const rel = path.relative(safeRoot, resolvedDir);
    if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
      throw new Error(
        `Path escape detected: ${JSON.stringify(resolvedDir)} is not within ${JSON.stringify(safeRoot)}`
      );
    }
  }
  await fs.rm(resolvedDir, { recursive: true, force: true });
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
  cactusCachedModelIds.clear();
  cactusSessions.clear();
}

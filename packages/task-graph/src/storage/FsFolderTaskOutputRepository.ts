/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTabularStorage } from "@workglow/storage";
import { makeFingerprint } from "@workglow/util";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CacheRef } from "../cache/CacheRef";
import { makeCacheRef } from "../cache/CacheRef";
import type { TaskInput } from "../task/TaskTypes";
import { tabularTaskOutputStorage } from "./TabularTaskOutputStorage";
import {
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "./TaskOutputTabularRepository";

/**
 * Blob names are `<sanitized-taskType>_<input-fingerprint>.bin`; anything else
 * (including in-flight `.tmp` files and foreign `$ref` schemes) never resolves.
 * The single-segment match also rules out path traversal through a crafted ref.
 */
const REF_PATTERN = /^fsfolder:\/\/blobs\/([A-Za-z0-9._-]+\.bin)$/;

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * Filesystem-backed task output repository with full binary streaming support.
 *
 * JSON output rows are stored through {@link FsFolderTabularStorage} (one file
 * per row, compression and TTL pruning inherited from
 * {@link TaskOutputTabularRepository}). Binary payloads written via
 * `saveOutputStream` live as sidecar files under `<folder>/blobs/`, written
 * incrementally (never materialized) to a `.tmp` file and atomically renamed
 * on completion — a crash mid-write never publishes a readable partial blob.
 * The temp handle is `sync()`'d before rename so a power loss between the
 * rename and the OS flushing dirty data cannot leave the published blob name
 * pointing at zero bytes. We intentionally do NOT fsync the containing
 * directory: the rename is durable enough for cache semantics (a crash that
 * loses the rename simply forces a recompute), and the directory fsync would
 * add a syscall to every write for negligible benefit.
 *
 * The blob name derives from `(taskType, fingerprint(inputs))`, so re-running
 * the same task overwrites its previous blob instead of leaking files.
 *
 * Two instances pointed at the same folder interoperate: a `CacheRef` written
 * by one resolves through the other (the cross-process contract for queue
 * consumers). Node/Bun only — exported via the package's server entries.
 *
 * Multi-tenant warning: blob names in the deterministic cache path are derived
 * from `(sanitize(taskType), fingerprint(inputs))` with no tenant axis, so two
 * tenants running the same task with identical inputs share a blob — an
 * existence side-channel for sensitive inputs. This repository assumes a
 * SINGLE-TENANT deployment. For multi-tenant use, wrap with a per-tenant
 * folder/prefix at the layer above, or scope writes through
 * {@link RunPrivateCacheRepo} so each run namespaces its own blobs.
 */
export class FsFolderTaskOutputRepository extends TaskOutputTabularRepository {
  private readonly blobsDir: string;

  constructor(folderPath: string) {
    super({
      storage: tabularTaskOutputStorage(
        new FsFolderTabularStorage(folderPath, TaskOutputSchema, TaskOutputPrimaryKeyNames)
      ),
    });
    this.blobsDir = join(folderPath, "blobs");
  }

  override async saveOutputStream(
    taskType: string,
    inputs: TaskInput,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    await mkdir(this.blobsDir, { recursive: true });
    // The fingerprint covers the raw taskType too: `sanitize` is lossy, so two
    // distinct task types can share a sanitized prefix — the hash keeps their
    // blobs distinct while the prefix keeps names greppable and prefix-deletable.
    // Note (multi-tenant): there is no tenant axis here. Identical inputs from
    // two tenants resolve to the same name and share a blob. See the class
    // JSDoc for the deployment assumption and the documented wrappers.
    const fingerprint = await makeFingerprint({ __taskType: taskType, inputs });
    const name = `${sanitize(taskType)}_${fingerprint}.bin`;
    const tmpPath = join(this.blobsDir, `${name}.tmp`);
    const handle = await open(tmpPath, "w");
    let size = 0;
    try {
      try {
        for await (const chunk of chunks) {
          await handle.write(chunk);
          size += chunk.byteLength;
        }
        // Flush the file's data to the underlying storage before we publish
        // it under the final name. Without this, a power loss between the
        // rename and the OS flushing dirty pages can leave the published
        // blob name pointing at zero bytes (FS-dependent). Data-level
        // durability is what the cache contract needs; we deliberately skip
        // the directory fsync (its cost outweighs the benefit for a cache).
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmpPath, join(this.blobsDir, name));
    } catch (err) {
      // A failed write or rename must not leave a stray .tmp behind.
      await rm(tmpPath, { force: true });
      throw err;
    }
    this.emit("output_saved", taskType);
    const mime = typeof metadata.mime === "string" ? metadata.mime : undefined;
    return makeCacheRef({ $ref: `fsfolder://blobs/${name}`, size, mime });
  }

  private blobPath(ref: CacheRef): string | undefined {
    const match = REF_PATTERN.exec(ref.$ref);
    return match ? join(this.blobsDir, match[1]) : undefined;
  }

  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const path = this.blobPath(ref);
    if (path === undefined) return undefined;
    try {
      return new Blob([await readFile(path)]);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  override getOutputStreamByRef(ref: CacheRef): AsyncIterable<Uint8Array> | undefined {
    const path = this.blobPath(ref);
    if (path === undefined || !existsSync(path)) return undefined;
    return (async function* () {
      for await (const chunk of createReadStream(path)) {
        yield chunk as Uint8Array;
      }
    })();
  }

  override async deleteOutputByRef(ref: CacheRef): Promise<void> {
    const path = this.blobPath(ref);
    if (path === undefined) return;
    await rm(path, { force: true });
  }

  override async clear(): Promise<void> {
    await super.clear();
    await rm(this.blobsDir, { recursive: true, force: true });
  }

  /**
   * Prune rows and blobs older than `olderThanInMs`. Operators SHOULD schedule
   * this (e.g. via {@link CacheJanitor}) on a recurring cadence: it is also
   * the sweep that reclaims orphan blobs left by process crashes between a
   * successful stream-write and the row commit (the runner cleans up best-
   * effort via {@link TaskOutputRepository.deleteOutputByRef} on synchronous
   * save failure, but a hard kill races that path). Without periodic
   * `clearOlderThan`, stranded blobs accumulate without bound.
   */
  override async clearOlderThan(olderThanInMs: number): Promise<void> {
    const cutoff = Date.now() - olderThanInMs;
    // FsFolderTabularStorage does not implement deleteSearch (the base
    // implementation's pruning path), so prune rows by scanning.
    for await (const row of this.storage.records()) {
      const ts = typeof row.createdAt === "string" ? new Date(row.createdAt).getTime() : NaN;
      if (!isNaN(ts) && ts < cutoff) {
        await this.storage.delete({ key: row.key, taskType: row.taskType });
      }
    }
    this.emit("output_pruned");
    await this.deleteBlobsByPrefix("", cutoff);
  }

  /**
   * Row deletions scoped by `taskType` prefix (run-private cleanup via
   * `RunPrivateCacheRepo.clearRun()` and `CacheJanitor`) must cascade to the
   * blob sidecar files, or every streamed run-private payload leaks on disk
   * after its rows are pruned. Blob names start with the sanitized taskType,
   * and `sanitize` preserves prefix relationships, so a sanitized-prefix match
   * selects exactly the rows' blobs (a cross-prefix collision would require
   * two raw prefixes with identical sanitized forms — run namespaces embed a
   * UUID, so this does not occur in practice).
   */
  override async deleteByTaskTypePrefix(prefix: string): Promise<void> {
    await super.deleteByTaskTypePrefix(prefix);
    await this.deleteBlobsByPrefix(sanitize(prefix));
  }

  override async clearOlderThanWithTaskTypePrefix(
    prefix: string,
    olderThanInMs: number
  ): Promise<void> {
    await super.clearOlderThanWithTaskTypePrefix(prefix, olderThanInMs);
    await this.deleteBlobsByPrefix(sanitize(prefix), Date.now() - olderThanInMs);
  }

  private async deleteBlobsByPrefix(namePrefix: string, olderThanMtimeMs?: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.blobsDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.startsWith(namePrefix)) continue;
      const path = join(this.blobsDir, name);
      try {
        if (olderThanMtimeMs !== undefined && (await stat(path)).mtimeMs >= olderThanMtimeMs) {
          continue;
        }
        await rm(path, { force: true });
      } catch {
        // Raced with a concurrent write or delete; the next sweep catches it.
      }
    }
  }
}

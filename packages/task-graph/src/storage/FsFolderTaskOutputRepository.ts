/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTabularStorage } from "@workglow/storage";
import { makeFingerprint } from "@workglow/util";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CacheRef } from "../cache/CacheRef";
import { makeCacheRef } from "../cache/CacheRef";
import type { StreamMode } from "../task/StreamTypes";
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
const REF_PATTERN = /^fsfolder:\/\/blobs\/([\w.-]+\.bin)$/;

function sanitize(s: string): string {
  return s.replace(/[^\w.-]/g, "-");
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
 * pointing at zero bytes. The containing directory is then `sync()`'d as
 * well so the rename itself is durable: on ext4 `data=ordered` and similar
 * filesystems, a crash between the rename returning and the directory
 * metadata being flushed can otherwise leave the published name pointing at
 * stale (zero-byte) content. The dir fsync runs best-effort — platforms
 * that reject opening a directory for fsync (`EPERM` / `EINVAL` / `ENOTSUP`
 * / `EISDIR`) fall through silently.
 *
 * Each `saveOutputStream` call mints a unique blob filename of the form
 * `<sanitized-taskType>_<fingerprint>_<uuid>.bin`. Two concurrent writers
 * computing the same `(taskType, inputs)` therefore land at distinct paths,
 * so a failed-row-commit cleanup on one writer cannot remove the published
 * blob the other writer's row still points at. Stale blobs from crashes
 * between rename and row commit are reclaimed by `clearOlderThan` (which prunes
 * old rows and sweeps sidecar blobs by mtime) and the {@link CacheJanitor}.
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
    const fingerprint = await makeFingerprint({ __taskType: taskType, inputs });
    const name = `${sanitize(taskType)}_${fingerprint}_${randomUUID()}.bin`;
    const size = await this.writeSidecar(name, chunks);
    this.emit("output_saved", taskType);
    const mime = typeof metadata.mime === "string" ? metadata.mime : undefined;
    return makeCacheRef({ $ref: `fsfolder://blobs/${name}`, size, mime });
  }

  override async saveOutputStreamPort(
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    const fingerprint = await makeFingerprint({ __taskType: taskType, inputs });
    // Port is part of the name so a multi-port task's sidecars are distinct and
    // remain greppable / prefix-deletable; the file stays an opaque `.bin` so
    // the existing readers resolve it unchanged — the codec to replay is named
    // by the ref's `mode`, not the extension.
    const name = `${sanitize(taskType)}_${fingerprint}_${sanitize(port)}_${randomUUID()}.bin`;
    const size = await this.writeSidecar(name, chunks);
    this.emit("output_saved", taskType);
    const mime = typeof metadata.mime === "string" ? metadata.mime : undefined;
    return makeCacheRef({ $ref: `fsfolder://blobs/${name}`, port, mode, size, mime });
  }

  /**
   * Stream `chunks` to a uniquely-named sidecar under `blobsDir`, returning the
   * byte count. Bytes go to a `.tmp` file, are fsync'd, then atomically renamed
   * to `name` — a crash mid-write never publishes a readable partial blob. The
   * directory entry is fsync'd best-effort so the rename itself survives a crash
   * (FS-dependent); platforms that reject directory fsync fall through silently.
   * Callers compute `name` (the prefix keeps names greppable and prefix-
   * deletable; a per-write UUID suffix makes every path unique so two concurrent
   * writers with the same `(taskType, inputs)` cannot race on one file).
   */
  private async writeSidecar(name: string, chunks: AsyncIterable<Uint8Array>): Promise<number> {
    await mkdir(this.blobsDir, { recursive: true });
    const tmpPath = join(this.blobsDir, `${name}.tmp`);
    const handle = await open(tmpPath, "w");
    let size = 0;
    try {
      try {
        for await (const chunk of chunks) {
          await handle.write(chunk);
          size += chunk.byteLength;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmpPath, join(this.blobsDir, name));
      try {
        const dir = await open(this.blobsDir, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR") {
          throw err;
        }
      }
    } catch (err) {
      // A failed write or rename must not leave a stray .tmp behind.
      await rm(tmpPath, { force: true });
      throw err;
    }
    return size;
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

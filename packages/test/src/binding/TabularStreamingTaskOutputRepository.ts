/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, ITaskOutputStorage, StreamMode, TaskInput } from "@workglow/task-graph";
import {
  makeCacheRef,
  makeRefPattern,
  mintRefKey,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { makeFingerprint } from "@workglow/util";

/**
 * Structural contract for a blob store keyed by opaque `refKey`, as consumed by
 * {@link TabularStreamingTaskOutputRepository}. Both `TabularBlobChunkStore`
 * (SQL-shaped chunk/manifest tables) and `IdbBlobChunkStore` (raw IndexedDB)
 * satisfy it, so one repository base serves every chunked-blob backing.
 */
export interface IBlobChunkStore {
  setup(): Promise<void>;
  /**
   * Stream `chunks` into the store under `refKey`; returns the total byte
   * count. Implementations must never accumulate the whole payload.
   */
  writeStream(
    refKey: string,
    chunks: AsyncIterable<Uint8Array>,
    createdAt?: string
  ): Promise<number>;
  /** Materialize the whole payload as a Blob, or `undefined` on miss. */
  readBlob(refKey: string): Promise<Blob | undefined>;
  /**
   * Bounded-memory ordered read of the payload's bytes; `undefined` when the
   * ref is absent.
   */
  readStream(refKey: string): Promise<AsyncIterable<Uint8Array> | undefined>;
  /** Delete a ref's payload. Idempotent. */
  deleteRef(refKey: string): Promise<void>;
  /** Remove every stored payload. */
  clear(): Promise<void>;
  /** Delete every ref created strictly before `cutoffIso`. */
  pruneOlderThan(cutoffIso: string): Promise<void>;
}

/**
 * Shared base for durable streaming task-output repositories. JSON output rows
 * persist through an injected {@link ITaskOutputStorage}; streamed port
 * payloads persist as ordered chunks via an injected {@link IBlobChunkStore},
 * referenced by a {@link CacheRef} whose `$ref` carries the subclass's
 * `<scheme>://<refKey>` form.
 *
 * Subclasses (Postgres, SQLite, IndexedDB, …) only wire the backend-specific
 * storages and pick a `scheme`; every streaming method lives here. Mirrors
 * `FsFolderTaskOutputRepository`: writes never accumulate, reads are bounded per
 * chunk, and two instances over the same backing interoperate. Reads are
 * asynchronous, so `getOutputStreamByRef` returns a Promise — the runtime's
 * `streamRefViaBacking` awaits it, so a dangling ref still resolves to a miss.
 *
 * Each write mints a unique `refKey` (per-write UUID suffix), so two concurrent
 * writers of the same `(taskType, inputs[, port])` land at distinct keys; a
 * re-write leaks the previous chunks until {@link clearOlderThan} / {@link clear}
 * reclaims them.
 */
export abstract class TabularStreamingTaskOutputRepository extends TaskOutputTabularRepository {
  private readonly blobs: IBlobChunkStore;
  private readonly scheme: string;
  private readonly refPattern: RegExp;

  protected constructor(opts: {
    storage: ITaskOutputStorage;
    blobs: IBlobChunkStore;
    scheme: string;
  }) {
    super({ storage: opts.storage });
    this.blobs = opts.blobs;
    this.scheme = opts.scheme;
    this.refPattern = makeRefPattern(opts.scheme);
  }

  override async setupDatabase(): Promise<void> {
    await super.setupDatabase();
    await this.blobs.setup();
  }

  override async saveOutputStream(
    taskType: string,
    inputs: TaskInput,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    const fingerprint = await makeFingerprint({ __taskType: taskType, inputs });
    const refKey = mintRefKey(taskType, fingerprint);
    const size = await this.blobs.writeStream(refKey, chunks);
    this.emit("output_saved", taskType);
    const mime = typeof metadata.mime === "string" ? metadata.mime : undefined;
    return makeCacheRef({ $ref: `${this.scheme}://${refKey}`, size, mime });
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
    const refKey = mintRefKey(taskType, fingerprint, port);
    const size = await this.blobs.writeStream(refKey, chunks);
    this.emit("output_saved", taskType);
    const mime = typeof metadata.mime === "string" ? metadata.mime : undefined;
    return makeCacheRef({ $ref: `${this.scheme}://${refKey}`, port, mode, size, mime });
  }

  private refKeyOf(ref: CacheRef): string | undefined {
    const match = this.refPattern.exec(ref.$ref);
    return match ? match[1] : undefined;
  }

  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const refKey = this.refKeyOf(ref);
    if (refKey === undefined) return undefined;
    return this.blobs.readBlob(refKey);
  }

  override async getOutputStreamByRef(
    ref: CacheRef
  ): Promise<AsyncIterable<Uint8Array> | undefined> {
    const refKey = this.refKeyOf(ref);
    if (refKey === undefined) return undefined;
    return this.blobs.readStream(refKey);
  }

  override async deleteOutputByRef(ref: CacheRef): Promise<void> {
    const refKey = this.refKeyOf(ref);
    if (refKey === undefined) return;
    await this.blobs.deleteRef(refKey);
  }

  override async clear(): Promise<void> {
    await super.clear();
    await this.blobs.clear();
  }

  override async clearOlderThan(olderThanInMs: number): Promise<void> {
    await super.clearOlderThan(olderThanInMs);
    await this.blobs.pruneOlderThan(new Date(Date.now() - olderThanInMs).toISOString());
  }
}

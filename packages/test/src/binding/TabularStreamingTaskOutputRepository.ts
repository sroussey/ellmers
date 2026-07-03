/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, ITaskOutputStorage, StreamMode, TaskInput } from "@workglow/task-graph";
import { makeCacheRef, TaskOutputTabularRepository } from "@workglow/task-graph";
import { makeFingerprint, uuid4 } from "@workglow/util";
import type { TabularBlobChunkStore } from "./TabularBlobChunkStore";

function sanitize(s: string): string {
  return s.replace(/[^\w.-]/g, "-");
}

/**
 * Shared base for durable, SQL-shaped streaming task-output repositories. JSON
 * output rows persist through an injected {@link ITaskOutputStorage}; streamed
 * port payloads persist as ordered chunk rows via an injected
 * {@link TabularBlobChunkStore}, referenced by a {@link CacheRef} whose `$ref`
 * carries the subclass's `<scheme>://<refKey>` form.
 *
 * Subclasses (Postgres, SQLite, …) only wire the backend-specific tabular
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
  private readonly blobs: TabularBlobChunkStore;
  private readonly scheme: string;
  private readonly refPattern: RegExp;

  protected constructor(opts: {
    storage: ITaskOutputStorage;
    blobs: TabularBlobChunkStore;
    scheme: string;
  }) {
    super({ storage: opts.storage });
    this.blobs = opts.blobs;
    this.scheme = opts.scheme;
    // The refKey is a single path-segment-free token, so a foreign `$ref`
    // scheme or a traversal-shaped ref never resolves to a stored blob.
    this.refPattern = new RegExp(`^${opts.scheme}://([\\w.-]+)$`);
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
    const refKey = `${sanitize(taskType)}_${fingerprint}_${uuid4()}`;
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
    const refKey = `${sanitize(taskType)}_${fingerprint}_${sanitize(port)}_${uuid4()}`;
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

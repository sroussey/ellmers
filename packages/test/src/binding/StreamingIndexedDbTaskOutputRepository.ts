/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import type { CacheRef, StreamMode, TaskInput } from "@workglow/task-graph";
import {
  makeCacheRef,
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";
import { makeFingerprint, uuid4 } from "@workglow/util";
import { IdbBlobChunkStore } from "./IdbBlobChunkStore";

/**
 * `refKey`s are `<sanitized-taskType>_<fingerprint>[_<sanitized-port>]_<uuid>`;
 * the pattern is a single path-segment-free token so a foreign `$ref` scheme or
 * a traversal-shaped ref never resolves to a stored blob.
 */
const REF_PATTERN = /^idbblob:\/\/([\w.-]+)$/;

function sanitize(s: string): string {
  return s.replace(/[^\w.-]/g, "-");
}

/**
 * Durable, browser-oriented streaming task-output repository. JSON output rows
 * are stored through {@link IndexedDbTabularStorage} (same as the non-streaming
 * `IndexedDbTaskOutputRepository`); streamed binary/text/object port payloads
 * are persisted as codec-encoded byte streams in a dedicated IndexedDB database
 * via {@link IdbBlobChunkStore}, referenced by a {@link CacheRef}.
 *
 * Mirrors `FsFolderTaskOutputRepository`: writes never accumulate the payload,
 * reads are bounded per chunk, and two instances over the same `dbName`
 * interoperate. Because IndexedDB has no synchronous existence probe, the
 * by-ref readers are asynchronous — the runtime's `streamRefViaBacking` awaits
 * them, so a dangling ref still resolves to a cache miss.
 *
 * Each write mints a unique `refKey` (per-write UUID suffix), so two concurrent
 * writers of the same `(taskType, inputs[, port])` land at distinct keys and
 * cannot race one another's chunk rows; a re-write leaks the previous blob until
 * {@link clearOlderThan} / {@link clear} reclaims it, exactly like the
 * filesystem backing.
 */
export class StreamingIndexedDbTaskOutputRepository extends TaskOutputTabularRepository {
  private readonly blobs: IdbBlobChunkStore;

  constructor(dbName: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new IndexedDbTabularStorage(dbName, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
    });
    this.blobs = new IdbBlobChunkStore(dbName);
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
    return makeCacheRef({ $ref: `idbblob://${refKey}`, size, mime });
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
    return makeCacheRef({ $ref: `idbblob://${refKey}`, port, mode, size, mime });
  }

  private refKeyOf(ref: CacheRef): string | undefined {
    const match = REF_PATTERN.exec(ref.$ref);
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

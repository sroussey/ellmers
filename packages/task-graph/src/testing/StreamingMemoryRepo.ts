/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, StreamMode, TaskInput, TaskOutput } from "@workglow/task-graph";
import { makeCacheRef, TaskOutputRepository } from "@workglow/task-graph";

/**
 * In-memory {@link TaskOutputRepository} implementing the full streaming
 * surface (`saveOutputStreamPort`, `getOutputByRef`, `getOutputStreamByRef`).
 * Test-only: bytes live in process memory, keyed by `$ref`.
 */
export class StreamingMemoryRepo extends TaskOutputRepository {
  public readonly streamed = new Map<string, Uint8Array>();
  public readonly streamedMetadata = new Map<string, Record<string, unknown>>();
  /** When set, `getOutputStreamByRef` yields slices of at most this many bytes. */
  public streamReadChunkSize: number | undefined;
  private store = new Map<string, TaskOutput>();

  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.store.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.store.clear();
    this.streamed.clear();
  }
  override async size(): Promise<number> {
    return this.store.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
  override async saveOutputStreamPort(
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef> {
    const parts: Uint8Array[] = [];
    for await (const c of chunks) parts.push(c);
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.byteLength;
    }
    const key = taskType + JSON.stringify(inputs) + "#" + port;
    this.streamed.set(key, merged);
    this.streamedMetadata.set(key, metadata);
    return makeCacheRef({ $ref: `inmem://${key}`, port, mode, size: total });
  }
  override async getOutputByRef(ref: CacheRef): Promise<Blob | undefined> {
    const key = ref.$ref.replace(/^inmem:\/\//, "");
    const bytes = this.streamed.get(key);
    return bytes === undefined ? undefined : new Blob([bytes as unknown as BlobPart]);
  }
  override async getOutputStreamByRef(
    ref: CacheRef
  ): Promise<AsyncIterable<Uint8Array> | undefined> {
    const key = ref.$ref.replace(/^inmem:\/\//, "");
    const bytes = this.streamed.get(key);
    if (bytes === undefined) return undefined;
    const chunkSize = this.streamReadChunkSize ?? (bytes.byteLength || 1);
    return (async function* () {
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        yield bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
      }
    })();
  }
}

/**
 * In-memory {@link TaskOutputRepository} that deliberately omits every
 * streaming method, for capability-gating tests.
 */
export class NonStreamingMemoryRepo extends TaskOutputRepository {
  private store = new Map<string, TaskOutput>();

  override async saveOutput(t: string, i: TaskInput, o: TaskOutput): Promise<void> {
    this.store.set(t + JSON.stringify(i), o);
  }
  override async getOutput(t: string, i: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(t + JSON.stringify(i));
  }
  override async clear(): Promise<void> {
    this.store.clear();
  }
  override async size(): Promise<number> {
    return this.store.size;
  }
  override async clearOlderThan(): Promise<void> {}
  override isDurable(): boolean {
    return false;
  }
}

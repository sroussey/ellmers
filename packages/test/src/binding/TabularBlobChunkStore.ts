/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";

/**
 * Chunk table schema: one ordered byte slice per row. `bytes` is a
 * blob-encoded column (raw bytes stored under a string-typed schema, exactly
 * like `TaskOutputSchema.value`); SQL backings map it to `bytea`.
 */
export const BlobChunkSchema = {
  type: "object",
  properties: {
    refKey: { type: "string" },
    seq: { type: "number" },
    bytes: { type: "string", contentEncoding: "blob" },
    createdAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const BlobChunkPrimaryKeyNames = ["refKey", "seq"] as const;

/**
 * Manifest table schema: one row per ref. Acts as the existence witness (so a
 * zero-chunk empty payload is distinguishable from a missing ref) and carries
 * total size + creation timestamp for `CacheRef.size` and age pruning.
 */
export const BlobManifestSchema = {
  type: "object",
  properties: {
    refKey: { type: "string" },
    size: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const BlobManifestPrimaryKeyNames = ["refKey"] as const;

type ChunkTabular = ITabularStorage<typeof BlobChunkSchema, typeof BlobChunkPrimaryKeyNames>;
type ManifestTabular = ITabularStorage<
  typeof BlobManifestSchema,
  typeof BlobManifestPrimaryKeyNames
>;

const DEFAULT_PAGE_SIZE = 64;

/**
 * Max bytes buffered per write page: incoming deltas accumulate up to this
 * budget and each full page flushes its rows in ONE `putBulk`, so a
 * many-small-delta stream costs one storage round-trip per ~256 KiB instead of
 * one per delta. The buffer is bounded by the budget plus one delta — the
 * whole payload is never accumulated.
 */
const WRITE_PAGE_BYTES = 256 * 1024;

/** Normalize whatever a backing returns for a blob column to a `Uint8Array`. */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error(`TabularBlobChunkStore: unexpected blob column runtime type ${typeof value}`);
}

/**
 * A blob store keyed by opaque `refKey`, backed by two {@link ITabularStorage}
 * tables (chunks + manifest). Works over any tabular backing — Postgres,
 * SQLite, Supabase, in-memory — so a single implementation serves every
 * SQL-shaped streaming cache backing.
 *
 * Streaming writes keep one chunk row per incoming delta but flush rows in
 * ~256 KiB pages via `putBulk` (never accumulating the whole payload); reads
 * keyset-page the chunk table by `seq` so at most `pageSize` rows are resident
 * at once and each page is its own query. The manifest row is written last and
 * is the existence witness.
 */
export class TabularBlobChunkStore {
  private readonly chunks: ChunkTabular;
  private readonly manifest: ManifestTabular;
  private readonly pageSize: number;

  constructor(
    chunks: ChunkTabular,
    manifest: ManifestTabular,
    pageSize: number = DEFAULT_PAGE_SIZE
  ) {
    this.chunks = chunks;
    this.manifest = manifest;
    this.pageSize = Math.max(1, pageSize);
  }

  async setup(): Promise<void> {
    await this.chunks.setupDatabase?.();
    await this.manifest.setupDatabase?.();
  }

  /**
   * Stream `chunks` into the store under `refKey` — one chunk row per incoming
   * delta, rows flushed in ~{@link WRITE_PAGE_BYTES} pages via `putBulk` —
   * then commit the manifest row. Returns the total byte count.
   */
  async writeStream(
    refKey: string,
    chunks: AsyncIterable<Uint8Array>,
    createdAt: string = new Date().toISOString()
  ): Promise<number> {
    let size = 0;
    let seq = 0;
    type ChunkInsert = Parameters<ChunkTabular["putBulk"]>[0][number];
    let page: ChunkInsert[] = [];
    let pageBytes = 0;
    const flush = async (): Promise<void> => {
      if (page.length === 0) return;
      await this.chunks.putBulk(page);
      page = [];
      pageBytes = 0;
    };
    for await (const chunk of chunks) {
      page.push({
        refKey,
        seq,
        // Blob column: raw bytes stored under a string-typed schema (see
        // BlobChunkSchema); reads normalize the round-tripped shape.
        bytes: chunk as unknown as string,
        createdAt,
      });
      pageBytes += chunk.byteLength;
      size += chunk.byteLength;
      seq += 1;
      if (pageBytes >= WRITE_PAGE_BYTES) await flush();
    }
    await flush();
    await this.manifest.put({ refKey, size, createdAt });
    return size;
  }

  async has(refKey: string): Promise<boolean> {
    return (await this.manifest.get({ refKey })) !== undefined;
  }

  /**
   * Bounded-memory ordered read: yields each chunk's bytes in `seq` order,
   * keyset-paging the chunk table so at most `pageSize` rows load per query.
   * Resolves `undefined` when the ref is absent (no manifest row).
   */
  async readStream(refKey: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    if (!(await this.has(refKey))) return undefined;
    return this.iterateChunks(refKey);
  }

  private async *iterateChunks(refKey: string): AsyncIterable<Uint8Array> {
    let after = -1;
    for (;;) {
      const rows = await this.chunks.query(
        { refKey, seq: { value: after, operator: ">" } },
        { orderBy: [{ column: "seq", direction: "ASC" }], limit: this.pageSize }
      );
      if (rows === undefined || rows.length === 0) return;
      for (const row of rows) yield toUint8Array(row.bytes);
      if (rows.length < this.pageSize) return;
      // `seq` is optional on the schema-derived row type but always present at
      // runtime (writeStream sets it); guard to keep `after` a number.
      const lastSeq = rows[rows.length - 1]!.seq;
      if (lastSeq === undefined) return;
      after = lastSeq;
    }
  }

  /** Materialize the whole payload as a Blob, or `undefined` on miss. */
  async readBlob(refKey: string): Promise<Blob | undefined> {
    const stream = await this.readStream(refKey);
    if (stream === undefined) return undefined;
    const parts: BlobPart[] = [];
    for await (const chunk of stream) parts.push(chunk as unknown as BlobPart);
    return new Blob(parts);
  }

  /** Delete a ref's manifest and all its chunk rows. Idempotent. */
  async deleteRef(refKey: string): Promise<void> {
    await this.chunks.deleteSearch({ refKey });
    await this.manifest.deleteSearch({ refKey });
  }

  /** Delete every ref whose `createdAt` is strictly before `cutoffIso`. */
  async pruneOlderThan(cutoffIso: string): Promise<void> {
    await this.chunks.deleteSearch({ createdAt: { value: cutoffIso, operator: "<" } });
    await this.manifest.deleteSearch({ createdAt: { value: cutoffIso, operator: "<" } });
  }

  /** Remove all chunk + manifest rows. */
  async clear(): Promise<void> {
    await this.chunks.deleteAll();
    await this.manifest.deleteAll();
  }
}

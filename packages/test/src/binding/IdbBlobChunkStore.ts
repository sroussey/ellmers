/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { openIdb } from "@workglow/indexeddb/storage";

const CHUNKS_STORE = "chunks";
const MANIFEST_STORE = "manifest";
const DEFAULT_PAGE_SIZE = 64;

/**
 * Max bytes buffered per write page: incoming deltas accumulate up to this
 * budget and each full page commits its rows in ONE readwrite transaction, so
 * a many-small-delta stream costs one transaction per ~256 KiB instead of one
 * per delta. The buffer is bounded by the budget plus one delta — the whole
 * payload is never accumulated.
 */
const WRITE_PAGE_BYTES = 256 * 1024;

interface ChunkRow {
  readonly refKey: string;
  readonly seq: number;
  readonly bytes: Uint8Array;
}

interface ManifestRow {
  readonly refKey: string;
  readonly size: number;
  readonly createdAt: string;
}

/**
 * A raw-IndexedDB blob store keyed by opaque `refKey`. Bytes for one ref are
 * persisted as ordered `chunks` rows (keyPath `[refKey, seq]`); a `manifest`
 * row (keyPath `refKey`) records the total size and creation timestamp and acts
 * as the existence witness — so a legitimately empty (zero-chunk) payload is
 * still distinguishable from a missing ref.
 *
 * Writes keep one row per incoming chunk but batch row commits into ~256 KiB
 * pages (one transaction per page, never accumulating the whole payload); a
 * failed write best-effort deletes the rows it already committed. Reads page
 * the chunk store so at most `pageSize` chunk rows are resident at once and
 * each page runs in its own short-lived transaction (IndexedDB auto-closes an
 * idle transaction, so a single cursor cannot be held across a slow consumer).
 *
 * The database (`<dbName>__blobs`) is deterministic in `dbName`, so a second
 * instance constructed with the same `dbName` resolves refs the first wrote —
 * the cross-instance read contract.
 */
export class IdbBlobChunkStore {
  private readonly dbName: string;
  private readonly pageSize: number;
  private db: IDBDatabase | undefined;

  constructor(dbName: string, pageSize: number = DEFAULT_PAGE_SIZE) {
    this.dbName = `${dbName}__blobs`;
    this.pageSize = Math.max(1, pageSize);
  }

  async setup(): Promise<void> {
    if (this.db) return;
    this.db = await openIdb(this.dbName, {
      version: 1,
      onUpgradeNeeded: (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          db.createObjectStore(CHUNKS_STORE, { keyPath: ["refKey", "seq"] });
        }
        if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
          db.createObjectStore(MANIFEST_STORE, { keyPath: "refKey" });
        }
      },
    });
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) await this.setup();
    return this.db!;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  /**
   * Stream `chunks` into the store under `refKey` — one chunk row per incoming
   * delta, rows committed in ~{@link WRITE_PAGE_BYTES} pages (one transaction
   * per page) — then commit the manifest row as the existence witness. Returns
   * the total byte count; the whole payload is never accumulated in memory.
   *
   * On any failure (a rejected transaction, a throwing producer) the rows
   * already committed for `refKey` are best-effort deleted before rethrowing —
   * mirroring `FsFolderTaskOutputRepository`'s `.tmp` cleanup — so a failed
   * write does not strand manifest-less chunk rows. Whatever the cleanup
   * itself misses is reclaimed by {@link pruneOlderThan}'s orphan sweep.
   */
  async writeStream(
    refKey: string,
    chunks: AsyncIterable<Uint8Array>,
    createdAt: string = new Date().toISOString()
  ): Promise<number> {
    const db = await this.getDb();
    let size = 0;
    let seq = 0;
    let page: ChunkRow[] = [];
    let pageBytes = 0;
    try {
      for await (const chunk of chunks) {
        page.push({ refKey, seq, bytes: chunk });
        pageBytes += chunk.byteLength;
        size += chunk.byteLength;
        seq += 1;
        if (pageBytes >= WRITE_PAGE_BYTES) {
          await this.putAll(db, CHUNKS_STORE, page);
          page = [];
          pageBytes = 0;
        }
      }
      if (page.length > 0) {
        await this.putAll(db, CHUNKS_STORE, page);
        page = [];
      }
      const manifest: ManifestRow = { refKey, size, createdAt };
      await this.put(db, MANIFEST_STORE, manifest);
    } catch (err) {
      try {
        await this.deleteChunkRange(db, refKey);
      } catch {
        // Cleanup is best-effort; the pruneOlderThan orphan sweep catches it.
      }
      throw err;
    }
    return size;
  }

  async has(refKey: string): Promise<boolean> {
    return (await this.getManifest(refKey)) !== undefined;
  }

  /**
   * Bounded-memory ordered read: yields each chunk's bytes in `seq` order,
   * paging the chunk store so at most `pageSize` rows load per transaction.
   * Resolves `undefined` when the ref is absent (no manifest row).
   */
  async readStream(refKey: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    if (!(await this.has(refKey))) return undefined;
    return this.iterateChunks(refKey);
  }

  private async *iterateChunks(refKey: string): AsyncIterable<Uint8Array> {
    let after: number | undefined;
    for (;;) {
      const rows = await this.readChunkPage(refKey, after);
      if (rows.length === 0) return;
      for (const row of rows) yield row.bytes;
      if (rows.length < this.pageSize) return;
      after = rows[rows.length - 1]!.seq;
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
    const db = await this.getDb();
    await this.deleteChunkRange(db, refKey);
    await this.delete(db, MANIFEST_STORE, refKey);
  }

  /**
   * Delete every ref whose manifest `createdAt` is strictly before `cutoffIso`,
   * then sweep orphaned chunk rows: chunk rows carry no timestamp, so a crashed
   * write (chunks committed, manifest never written) would otherwise strand
   * unreachable rows forever. Any distinct chunk `refKey` without a manifest
   * row — never readable, since the manifest is the existence witness — has its
   * whole chunk range deleted.
   */
  async pruneOlderThan(cutoffIso: string): Promise<void> {
    const db = await this.getDb();
    const manifests = await this.getAll<ManifestRow>(db, MANIFEST_STORE);
    const live = new Set<string>();
    for (const m of manifests) {
      if (m.createdAt < cutoffIso) {
        await this.deleteRef(m.refKey);
      } else {
        live.add(m.refKey);
      }
    }
    for (const refKey of await this.distinctChunkRefKeys(db)) {
      if (!live.has(refKey)) await this.deleteChunkRange(db, refKey);
    }
  }

  /** Remove all chunk + manifest rows. */
  async clear(): Promise<void> {
    const db = await this.getDb();
    await this.clearStore(db, CHUNKS_STORE);
    await this.clearStore(db, MANIFEST_STORE);
  }

  // ---- IDB primitives -------------------------------------------------------

  private async getManifest(refKey: string): Promise<ManifestRow | undefined> {
    const db = await this.getDb();
    return this.get<ManifestRow>(db, MANIFEST_STORE, refKey);
  }

  private readChunkPage(refKey: string, after: number | undefined): Promise<ChunkRow[]> {
    return new Promise<ChunkRow[]>((resolve, reject) => {
      const tx = this.db!.transaction(CHUNKS_STORE, "readonly");
      const store = tx.objectStore(CHUNKS_STORE);
      // `[refKey, []]` upper bound: an array sorts after any number in IDB key
      // ordering, so it bounds every numeric `seq` for this refKey. A defined
      // `after` opens the lower bound exclusively so pages don't overlap.
      const lower = after === undefined ? [refKey] : [refKey, after];
      const range = IDBKeyRange.bound(lower, [refKey, []], after !== undefined, false);
      const req = store.getAll(range, this.pageSize);
      req.onsuccess = () => resolve(req.result as ChunkRow[]);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Enumerate the distinct `refKey`s present in the chunks store with a
   * keys-only cursor (no row values are loaded). After recording a refKey the
   * cursor jumps straight to the next one via `continue([refKey, []])` — an
   * array upper-bounds every numeric `seq` in IDB key order — so the scan
   * touches one key per refKey, not one per chunk row.
   */
  private distinctChunkRefKeys(db: IDBDatabase): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const refKeys: string[] = [];
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const req = tx.objectStore(CHUNKS_STORE).openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor === null) {
          resolve(refKeys);
          return;
        }
        const refKey = (cursor.key as [string, number])[0];
        refKeys.push(refKey);
        cursor.continue([refKey, []]);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private deleteChunkRange(db: IDBDatabase, refKey: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readwrite");
      const store = tx.objectStore(CHUNKS_STORE);
      const range = IDBKeyRange.bound([refKey], [refKey, []]);
      const req = store.delete(range);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private put(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
    return this.putAll(db, storeName, [value]);
  }

  /** Put every value in ONE readwrite transaction (one `oncomplete`). */
  private putAll(db: IDBDatabase, storeName: string, values: readonly unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const value of values) {
        const req = store.put(value);
        req.onerror = () => reject(req.error);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private get<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private delete(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const req = tx.objectStore(storeName).delete(key);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private clearStore(db: IDBDatabase, storeName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const req = tx.objectStore(storeName).clear();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

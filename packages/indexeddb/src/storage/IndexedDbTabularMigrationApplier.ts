/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ITabularMigrationApplier, type TabularMigrationOp } from "@workglow/storage";
import {
  IndexedDbMigrationRunner,
  type IndexedDbUpgradeContext,
} from "../migrations/IndexedDbMigrationRunner";

interface BackfillCapableStorage {
  getPage: (req?: { limit?: number; cursor?: unknown }) => Promise<{
    items: Array<Record<string, unknown>>;
    nextCursor?: unknown;
  }>;
  put: (row: Record<string, unknown>) => Promise<unknown>;
  delete: (row: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Read-only existence probe shared by `IndexedDbTabularMigrationApplier.tableExists`
 * and `IndexedDbTabularStorage.probeObjectStoreExists`. Opens the IDB
 * database without a version (which is the only documented way to read the
 * existing version + object stores) and inspects `objectStoreNames`.
 *
 * **Side effect:** if the database does not yet exist, IDB's spec says
 * `open(name)` *creates* it at version 1 with no object stores. The caller
 * must be prepared to handle that — `ensureIndexedDbTable` already does, by
 * deleting and recreating the empty DB before bumping its version.
 */
export async function idbObjectStoreExists(dbName: string, storeName: string): Promise<boolean> {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) throw new Error("indexedDB is not available in this environment");
  return new Promise<boolean>((resolve, reject) => {
    const req = idb.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const exists = db.objectStoreNames.contains(storeName);
      db.close();
      resolve(exists);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error(`IndexedDB ${dbName} blocked while probing for object store`));
  });
}

/**
 * IndexedDB applier for tabular migrations.
 *
 * Op handling matches `InMemoryTabularMigrationApplier`'s schemaless model
 * (column ops are no-ops) and `SqlTabularMigrationApplier`'s SQL-backed
 * model (DDL is real) where each makes sense:
 *
 *   - `addColumn` / `dropColumn` / `renameColumn` — **no-ops.** IDB stores
 *     arbitrary JS objects, so there is no schema to evolve. Authors who
 *     need to populate or rewrite a property on existing rows must pair
 *     the column op with an explicit `backfill` op (which runs on every
 *     backend, including SQL, where the backfill is in addition to the
 *     real ALTER TABLE). This keeps a single migration spec portable
 *     across backends.
 *   - `addIndex` / `dropIndex` — **real DDL.** Run inside an upgrade
 *     transaction issued by {@link IndexedDbMigrationRunner}, which writes
 *     the `_storage_migrations` row in the same transaction so DDL +
 *     bookkeeping commit atomically. `createIndex` / `deleteIndex` are
 *     guarded by `objectStore.indexNames.contains` so a re-run does not
 *     throw on already-existing / already-deleted indexes — mirroring
 *     SQL's `IF NOT EXISTS` / `IF EXISTS` semantics.
 *   - `backfill` — runs on a **separate** readwrite transaction *before*
 *     the upgrade tx, because IDB upgrade transactions cannot span async
 *     work. This means the backfill and the bookkeeping write are NOT
 *     atomic on this backend: if the upgrade tx fails after a partial
 *     backfill, the row mutations persist while no `(component, version)`
 *     row is written, and the next run re-invokes `transform()` on the
 *     already-mutated rows. **Backfill `transform`s on this applier MUST
 *     therefore be idempotent.** SQL backends wrap everything in
 *     `withTransaction` and do not have this requirement.
 *
 * Order of execution within a single migration: backfill first, then DDL.
 * This means a `[backfill, addIndex]` pair sees the new index applied to
 * the rewritten rows; the reverse order (`[addIndex, backfill]`) would
 * still execute backfill first because the runner buffers DDL until the
 * upgrade tx.
 */
export class IndexedDbTabularMigrationApplier implements ITabularMigrationApplier {
  private readonly runner: IndexedDbMigrationRunner;
  constructor(
    private readonly dbName: string,
    private readonly storeName: string,
    private readonly storage: BackfillCapableStorage,
    runner?: IndexedDbMigrationRunner
  ) {
    this.runner = runner ?? new IndexedDbMigrationRunner(dbName);
  }

  async ensureBookkeeping(): Promise<void> {
    await this.runner.ensureBookkeepingTable();
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    return this.runner.appliedVersions(component);
  }

  async tableExists(): Promise<boolean> {
    return idbObjectStoreExists(this.dbName, this.storeName);
  }

  async markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void> {
    if (versions.length === 0) return;
    await this.runner.run(
      versions.map((v) => ({
        component,
        version: v.version,
        description: v.description,
        up: () => undefined,
      }))
    );
  }

  async applyMigration(
    component: string,
    version: number,
    description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    // Exhaustive partition. The `never` default makes adding a new op
    // kind to TabularMigrationOp a TS error here rather than a silent
    // drop into one of two filters, which is how the previous version
    // of this code lost addColumn / dropColumn / renameColumn ops.
    type AddIndexOp = Extract<TabularMigrationOp, { kind: "addIndex" }>;
    type DropIndexOp = Extract<TabularMigrationOp, { kind: "dropIndex" }>;
    type BackfillOp = Extract<TabularMigrationOp, { kind: "backfill" }>;
    const ddlOps: Array<AddIndexOp | DropIndexOp> = [];
    const backfills: BackfillOp[] = [];
    for (const op of ops) {
      switch (op.kind) {
        case "addIndex":
        case "dropIndex":
          ddlOps.push(op);
          break;
        case "backfill":
          backfills.push(op);
          break;
        case "addColumn":
        case "dropColumn":
        case "renameColumn":
          // Schemaless backend — no schema to evolve. Pair with `backfill`
          // when row data needs to change. See class JSDoc.
          break;
        default: {
          const _exhaustive: never = op;
          throw new Error(
            `IndexedDbTabularMigrationApplier: unhandled op kind ${(_exhaustive as { kind: string }).kind}`
          );
        }
      }
    }

    // Run backfills FIRST on a normal readwrite tx. If any throws, no
    // bookkeeping is written, so the migration is retried on the next run
    // — which is why backfill transforms must be idempotent on this
    // backend (see class JSDoc).
    let processed = 0;
    const total = Math.max(ops.length, 1);
    for (const op of backfills) {
      const batchSize = op.batchSize ?? 500;
      let cursor: unknown;
      while (true) {
        const page = await this.storage.getPage({ limit: batchSize, cursor });
        for (const row of page.items) {
          const out = await op.transform(row);
          if (out === row) continue;
          if (out === undefined) {
            await this.storage.delete(row);
          } else {
            await this.storage.put(out);
          }
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      processed++;
      onProgress?.(processed / total);
    }

    // Then run DDL + bookkeeping atomically inside an upgrade transaction.
    // The runner.run() writes the `_storage_migrations` row inside the same
    // upgrade tx as our `up` callback, so DDL failure = no bookkeeping.
    // We always invoke runner.run() (even when ddlOps is empty) so that
    // bookkeeping is recorded for backfill-only and column-op-only
    // migrations.
    const storeName = this.storeName;
    await this.runner.run([
      {
        component,
        version,
        description,
        up: (ctx: IndexedDbUpgradeContext) => {
          if (!ctx.db.objectStoreNames.contains(storeName)) return;
          const store = ctx.tx.objectStore(storeName);
          for (const op of ddlOps) {
            if (op.kind === "addIndex") {
              if (store.indexNames.contains(op.name)) continue;
              const keyPath = op.columns.length === 1 ? op.columns[0] : [...op.columns];
              store.createIndex(op.name, keyPath, { unique: op.unique ?? false });
            } else {
              if (!store.indexNames.contains(op.name)) continue;
              store.deleteIndex(op.name);
            }
          }
        },
      },
    ]);
    processed += ddlOps.length;
    onProgress?.(processed / total);
  }
}

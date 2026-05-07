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
 * IndexedDB applier for tabular migrations. Order of operations:
 *
 *   1. **Backfills** run first on a normal readwrite transaction. They
 *      iterate via `storage.getPage` and rewrite rows. If a backfill
 *      throws, no bookkeeping has been written yet, so the next run
 *      retries the migration — matching the contract that failed
 *      migrations are NOT recorded as applied.
 *   2. **DDL ops** (`addIndex` / `dropIndex`) run inside an upgrade
 *      transaction issued by {@link IndexedDbMigrationRunner}. The runner
 *      writes `_storage_migrations` inside that same transaction, so the
 *      DDL + bookkeeping pair commit atomically.
 *
 * `createIndex` / `deleteIndex` are guarded with `objectStore.indexNames.contains`
 * so a re-run (or a fresh-DB pass that wasn't intercepted by the
 * orchestrator's fast path) does not throw on already-existing /
 * already-deleted indexes — mirroring SQL's `IF NOT EXISTS` / `IF EXISTS`
 * semantics.
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
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) throw new Error("indexedDB is not available in this environment");
    return new Promise<boolean>((resolve, reject) => {
      const req = idb.open(this.dbName);
      req.onsuccess = () => {
        const db = req.result;
        const exists = db.objectStoreNames.contains(this.storeName);
        db.close();
        resolve(exists);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () =>
        reject(new Error(`IndexedDB ${this.dbName} blocked while probing for object store`));
    });
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
    const ddlOps = ops.filter(
      (o): o is Extract<TabularMigrationOp, { kind: "addIndex" } | { kind: "dropIndex" }> =>
        o.kind === "addIndex" || o.kind === "dropIndex"
    );
    const backfills = ops.filter(
      (o): o is Extract<TabularMigrationOp, { kind: "backfill" }> => o.kind === "backfill"
    );

    // Run backfills FIRST on a normal readwrite tx. If any throws, no
    // bookkeeping is written, so the migration is retried on the next run.
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
    // bookkeeping is recorded for backfill-only migrations.
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

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ITabularMigrationApplier,
  type TabularMigrationOp,
} from "@workglow/storage";
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
 * IndexedDB applier for tabular migrations. Each migration's DDL ops
 * (`addIndex` / `dropIndex`) run inside an upgrade transaction issued by
 * {@link IndexedDbMigrationRunner}; the runner writes `_storage_migrations`
 * inside that same transaction, giving us all-or-nothing atomicity for the
 * DDL + bookkeeping pair.
 *
 * Backfills cannot run inside the upgrade transaction — IDB upgrade
 * transactions auto-commit as soon as control returns to the event loop
 * and cannot span async work. So `applyMigration` runs DDL through the
 * runner first, then performs `backfill` ops on a normal readwrite
 * transaction. A backfill that fails after the DDL has already committed
 * leaves the storage in a partial state; bookkeeping has already been
 * written, so the next run will not retry. Callers needing strict
 * atomicity should split DDL and backfill into separate migration
 * versions.
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
              const keyPath = op.columns.length === 1 ? op.columns[0] : [...op.columns];
              store.createIndex(op.name, keyPath, { unique: op.unique ?? false });
            } else {
              store.deleteIndex(op.name);
            }
          }
        },
      },
    ]);

    let processed = ddlOps.length;
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
  }
}

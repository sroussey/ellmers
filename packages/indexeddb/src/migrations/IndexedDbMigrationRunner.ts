/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IMigration,
  type IMigrationRunner,
  MIGRATIONS_TABLE,
  sortMigrations,
} from "@workglow/storage";

/**
 * Context handed to an IndexedDB migration's `up()` body. IDB's spec only
 * permits schema changes (createObjectStore, createIndex, etc.) inside an
 * `onupgradeneeded` callback, so migrations receive both the {@link IDBDatabase}
 * and the version-change {@link IDBTransaction} active during that callback.
 *
 * `up()` MUST be synchronous — IDB upgrade transactions auto-commit as soon as
 * the callback returns control to the event loop, so any awaited Promise
 * between IDB requests would silently lose the rest of the migration.
 */
export interface IndexedDbUpgradeContext {
  readonly db: IDBDatabase;
  readonly tx: IDBTransaction;
  readonly oldVersion: number;
  readonly newVersion: number;
}

/** Convenience alias for IndexedDB-flavoured migrations. */
export type IndexedDbMigration = IMigration<IndexedDbUpgradeContext>;

function getIndexedDb(): IDBFactory {
  // Node test environments (vitest + fake-indexeddb) install a global; browsers
  // expose it natively. We don't pick a fallback because callers in unsupported
  // runtimes (Bun without polyfill, Node without setup) need a clear failure.
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) {
    throw new Error(
      "indexedDB is not available in this environment. Provide one via the IndexedDbMigrationRunner constructor or polyfill globalThis.indexedDB."
    );
  }
  return idb;
}

/**
 * Runs versioned migrations against a single IndexedDB database.
 *
 * Mapping between {@link IMigration} and IDB's native versioning:
 *   - Migrations are sorted by `(component asc, version asc)` and assigned a
 *     1-based ordinal. The runner opens the database with `version =
 *     migrations.length`, which is the only event that triggers
 *     `onupgradeneeded`.
 *   - Inside the callback we apply migrations whose ordinal is greater than
 *     `oldVersion`, exactly once each, in order. The bookkeeping object store
 *     `_storage_migrations` records `(component, version, description,
 *     applied_at)` for traceability.
 *   - Adding new migrations later increments the ordinal count, which becomes
 *     the new IDB version — onupgradeneeded fires with `oldVersion =
 *     previousCount`, and only the truly-new migrations run.
 *
 * Caveats:
 *   - All migrations targeting one database must be passed to a single
 *     {@link run} call. Splitting them across calls would shrink the
 *     advertised version and IDB rejects opening at a lower version than
 *     the on-disk one.
 *   - `up()` must be synchronous (see {@link IndexedDbUpgradeContext}).
 */
export class IndexedDbMigrationRunner implements IMigrationRunner<IndexedDbUpgradeContext> {
  constructor(
    private readonly dbName: string,
    private readonly idb: IDBFactory = getIndexedDb()
  ) {}

  /**
   * Ensures the bookkeeping object store exists. We bump the IDB version by
   * one if the store is missing — that is the only IDB-permitted way to
   * create an object store.
   */
  async ensureBookkeepingTable(): Promise<void> {
    const probe = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.idb.open(this.dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (probe.objectStoreNames.contains(MIGRATIONS_TABLE)) {
      probe.close();
      return;
    }
    const currentVersion = probe.version;
    probe.close();
    await new Promise<void>((resolve, reject) => {
      const reopen = this.idb.open(this.dbName, currentVersion + 1);
      reopen.onupgradeneeded = () => {
        const u = reopen.result;
        if (!u.objectStoreNames.contains(MIGRATIONS_TABLE)) {
          u.createObjectStore(MIGRATIONS_TABLE, { keyPath: ["component", "version"] });
        }
      };
      reopen.onsuccess = () => {
        reopen.result.close();
        resolve();
      };
      reopen.onerror = () => reject(reopen.error);
      reopen.onblocked = () =>
        reject(new Error(`IndexedDB ${this.dbName} blocked while creating bookkeeping store`));
    });
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    return new Promise<Set<number>>((resolve, reject) => {
      const req = this.idb.open(this.dbName);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MIGRATIONS_TABLE)) {
          db.close();
          resolve(new Set());
          return;
        }
        const tx = db.transaction(MIGRATIONS_TABLE, "readonly");
        const store = tx.objectStore(MIGRATIONS_TABLE);
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const rows = getAll.result as Array<{ component: string; version: number }>;
          db.close();
          resolve(new Set(rows.filter((r) => r.component === component).map((r) => r.version)));
        };
        getAll.onerror = () => {
          db.close();
          reject(getAll.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  }

  async run(
    migrations: ReadonlyArray<IndexedDbMigration>
  ): Promise<ReadonlyArray<IndexedDbMigration>> {
    const sorted = sortMigrations(migrations);
    if (sorted.length === 0) return [];

    const targetVersion = sorted.length;
    const applied: IndexedDbMigration[] = [];

    // Always open at the target version. IDB will:
    //   - skip onupgradeneeded if the existing DB version >= targetVersion
    //     (no-op — all migrations already applied)
    //   - throw VersionError if the existing DB version > targetVersion
    //     (caller has fewer migrations than the DB has been migrated to;
    //      surface the error)
    //   - fire onupgradeneeded with oldVersion < targetVersion otherwise,
    //     and we run only the as-yet-unapplied migrations.
    //
    // We deliberately avoid a separate probe `idb.open(name)` (no version):
    // on a non-existent DB that creates an empty v1 with NO upgrade callback,
    // which would silently skip the real schema work below.
    await new Promise<void>((resolve, reject) => {
      const upreq = this.idb.open(this.dbName, targetVersion);
      upreq.onupgradeneeded = (ev) => {
        try {
          const db = upreq.result;
          const tx = upreq.transaction!;
          const oldVersion = ev.oldVersion;
          const newVersion = ev.newVersion ?? targetVersion;

          if (!db.objectStoreNames.contains(MIGRATIONS_TABLE)) {
            db.createObjectStore(MIGRATIONS_TABLE, { keyPath: ["component", "version"] });
          }
          const meta = tx.objectStore(MIGRATIONS_TABLE);

          // Migrations whose ordinal (1-based) > oldVersion need to run.
          for (let i = oldVersion; i < sorted.length; i++) {
            const m = sorted[i];
            const ctx: IndexedDbUpgradeContext = { db, tx, oldVersion, newVersion };
            const result = m.up(ctx);
            if (result instanceof Promise) {
              throw new Error(
                `IndexedDB migration "${m.component}@${m.version}" returned a Promise; ` +
                  `IDB upgrade transactions cannot span async work.`
              );
            }
            meta.add({
              component: m.component,
              version: m.version,
              description: m.description ?? null,
              applied_at: new Date().toISOString(),
            });
            applied.push(m);
          }
        } catch (err) {
          // Force the open request to fail by aborting the upgrade transaction.
          // The error gets surfaced via `onerror` below.
          try {
            upreq.transaction?.abort();
          } catch {
            // ignore
          }
          reject(err);
        }
      };
      upreq.onsuccess = () => {
        upreq.result.close();
        resolve();
      };
      upreq.onerror = () => reject(upreq.error);
      upreq.onblocked = () =>
        reject(new Error(`IndexedDB ${this.dbName} upgrade blocked — close other tabs.`));
    });

    return applied;
  }
}

/**
 * Convenience helper used by storage classes — runs the supplied migration
 * groups (one per IDB database) against fresh runners and returns an array
 * of the applied migrations across all groups.
 *
 * IndexedDB groups exist because some storages (e.g. the rate limiter) span
 * multiple databases and expose them as separate `(dbName, migrations)` pairs
 * via `getMigrations()`.
 */
export interface IndexedDbMigrationGroup {
  readonly dbName: string;
  readonly migrations: ReadonlyArray<IndexedDbMigration>;
}

export async function runIndexedDbMigrationGroups(
  groups: ReadonlyArray<IndexedDbMigrationGroup>,
  idb?: IDBFactory
): Promise<ReadonlyArray<IndexedDbMigration>> {
  const all: IndexedDbMigration[] = [];
  for (const group of groups) {
    const runner = idb
      ? new IndexedDbMigrationRunner(group.dbName, idb)
      : new IndexedDbMigrationRunner(group.dbName);
    const applied = await runner.run(group.migrations);
    all.push(...applied);
  }
  return all;
}

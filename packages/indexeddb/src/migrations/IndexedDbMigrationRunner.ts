/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IMigration,
  type IMigrationRunner,
  type RunMigrationsOptions,
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
 * Bookkeeping-driven dispatch (NOT IDB-version-ordinal driven). The runner:
 *   1. Probes the DB to read the `_storage_migrations` object store, building
 *      a set of already-applied `(component, version)` pairs. The probe
 *      registers an `onupgradeneeded` handler so that if the DB doesn't yet
 *      exist, IDB's auto-creation path also creates the bookkeeping store
 *      atomically (rather than leaving an empty v1 DB with no schema).
 *   2. Computes the pending migrations as `sorted \ alreadyApplied` —
 *      identifying each migration by `(component, version)`, NOT by its
 *      position in the sorted array. This means inserting a new migration
 *      that sorts BEFORE existing ones (e.g. a new component name that's
 *      lexicographically earlier) is still correctly detected as pending.
 *   3. If pending is empty, returns without bumping the IDB version.
 *   4. Otherwise reopens at `currentVersion + 1` and runs every pending
 *      migration inside the upgrade transaction, recording each in the
 *      bookkeeping store as it goes.
 *
 * The IDB database version is treated purely as a monotonic trigger for
 * `onupgradeneeded`; we never use it to decide which migrations to apply.
 *
 * Caveats:
 *   - `up()` must be synchronous. IDB upgrade transactions auto-commit as
 *     soon as control returns to the event loop, so awaited Promises between
 *     IDB requests would silently lose the rest of the migration. The runner
 *     throws if `up()` returns a Promise.
 */
export class IndexedDbMigrationRunner implements IMigrationRunner<IndexedDbUpgradeContext> {
  constructor(
    private readonly dbName: string,
    private readonly idb: IDBFactory = getIndexedDb()
  ) {}

  /**
   * Probe the DB without forcing a schema change. Reads the bookkeeping
   * store (creating it on first run via the auto-fired upgrade callback)
   * and returns the current IDB version + the set of applied migrations
   * keyed by `${component}@${version}`.
   */
  private async probe(): Promise<{ currentVersion: number; applied: Set<string> }> {
    return new Promise((resolve, reject) => {
      const req = this.idb.open(this.dbName);
      req.onupgradeneeded = () => {
        // Fires only when the DB doesn't already exist (oldVersion = 0).
        // We seed the bookkeeping store atomically with DB creation so a
        // fresh DB never lacks it.
        const u = req.result;
        if (!u.objectStoreNames.contains(MIGRATIONS_TABLE)) {
          u.createObjectStore(MIGRATIONS_TABLE, { keyPath: ["component", "version"] });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const currentVersion = db.version;
        if (!db.objectStoreNames.contains(MIGRATIONS_TABLE)) {
          // Existed prior to this runner ever being used — no bookkeeping yet.
          db.close();
          resolve({ currentVersion, applied: new Set() });
          return;
        }
        const tx = db.transaction(MIGRATIONS_TABLE, "readonly");
        const store = tx.objectStore(MIGRATIONS_TABLE);
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const rows = getAll.result as Array<{ component: string; version: number }>;
          db.close();
          resolve({
            currentVersion,
            applied: new Set(rows.map((r) => `${r.component}@${r.version}`)),
          });
        };
        getAll.onerror = () => {
          db.close();
          reject(getAll.error);
        };
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () =>
        reject(new Error(`IndexedDB ${this.dbName} blocked while probing for bookkeeping store`));
    });
  }

  /** Ensures the bookkeeping object store exists (created lazily by {@link probe}). */
  async ensureBookkeepingTable(): Promise<void> {
    await this.probe();
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    const { applied } = await this.probe();
    const versions = new Set<number>();
    for (const key of applied) {
      const at = key.lastIndexOf("@");
      if (at < 0) continue;
      const c = key.slice(0, at);
      const v = Number(key.slice(at + 1));
      if (c === component && Number.isFinite(v)) versions.add(v);
    }
    return versions;
  }

  async run(
    migrations: ReadonlyArray<IndexedDbMigration>,
    options: RunMigrationsOptions = {}
  ): Promise<ReadonlyArray<IndexedDbMigration>> {
    const sorted = sortMigrations(migrations);
    if (sorted.length === 0) return [];

    const { currentVersion, applied: alreadyApplied } = await this.probe();
    const pending = sorted.filter((m) => !alreadyApplied.has(`${m.component}@${m.version}`));
    if (pending.length === 0) return [];

    // Bump the IDB version monotonically — its only role is to trigger
    // onupgradeneeded. The bookkeeping store decides what actually runs.
    const targetVersion = currentVersion + 1;
    const applied: IndexedDbMigration[] = [];
    // Buffer events emitted from inside `onupgradeneeded` and flush after the
    // open request settles. Calling user code (the listener) inside the IDB
    // upgrade transaction can let microtasks slip in and auto-commit the
    // transaction before our migrations are done.
    const onProgress = options.onProgress;
    const buffered: Parameters<NonNullable<typeof onProgress>>[0][] = [];
    const emitLater = onProgress
      ? (ev: Parameters<NonNullable<typeof onProgress>>[0]) => buffered.push(ev)
      : undefined;

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

          for (const m of pending) {
            emitLater?.({
              component: m.component,
              version: m.version,
              phase: "starting",
              description: m.description,
            });
            const ctx: IndexedDbUpgradeContext = { db, tx, oldVersion, newVersion };
            const result = m.up(ctx, (fraction) => {
              emitLater?.({
                component: m.component,
                version: m.version,
                phase: "running",
                description: m.description,
                fraction,
              });
            });
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
            emitLater?.({
              component: m.component,
              version: m.version,
              phase: "completed",
              description: m.description,
              fraction: 1,
            });
          }
        } catch (err) {
          // Force the open request to fail by aborting the upgrade transaction.
          // The error gets surfaced via `onerror` below.
          try {
            upreq.transaction?.abort();
          } catch {
            // ignore
          }
          // Tag which migration failed (best-effort: the one whose `starting`
          // we last buffered without a matching `completed`).
          const lastStart = [...buffered].reverse().find((e) => e.phase === "starting");
          if (lastStart) {
            emitLater?.({
              component: lastStart.component,
              version: lastStart.version,
              phase: "failed",
              description: lastStart.description,
              error: err,
            });
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
    }).finally(() => {
      // Flush buffered events after the upgrade settles, regardless of
      // success/failure. Listeners always see a consistent "starting →
      // {completed | failed}" sequence.
      if (onProgress) {
        for (const ev of buffered) onProgress(ev);
      }
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
  options: RunMigrationsOptions & { idb?: IDBFactory } = {}
): Promise<ReadonlyArray<IndexedDbMigration>> {
  const { idb, onProgress } = options;
  const all: IndexedDbMigration[] = [];
  for (const group of groups) {
    const runner = idb
      ? new IndexedDbMigrationRunner(group.dbName, idb)
      : new IndexedDbMigrationRunner(group.dbName);
    const applied = await runner.run(group.migrations, { onProgress });
    all.push(...applied);
  }
  return all;
}

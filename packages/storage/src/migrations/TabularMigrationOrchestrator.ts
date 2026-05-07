/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ITabularMigration,
  ITabularMigrationApplier,
  TabularMigrationProgressListener,
} from "./TabularMigration";

/**
 * Sequences pending tabular migrations through a backend's
 * {@link ITabularMigrationApplier}.
 *
 * Two paths:
 *   - **fresh-DB fast path** — applied is empty AND `tableExists()` is false.
 *     Caller has already (or will) create the table at the target schema;
 *     the orchestrator records every declared migration as already-applied
 *     without running its ops.
 *   - **run-pending path** — sorted-by-version, skip already-applied,
 *     call `applyMigration` for each remaining one.
 *
 * Bookkeeping is owned by the applier (one row per `(component, version)`
 * in the existing `_storage_migrations` table).
 */
export interface RunTabularMigrationsOptions {
  readonly onProgress?: TabularMigrationProgressListener;
}

export async function runTabularMigrations(
  applier: ITabularMigrationApplier,
  defaultComponent: string,
  migrations: ReadonlyArray<ITabularMigration>,
  options: RunTabularMigrationsOptions = {}
): Promise<void> {
  if (migrations.length === 0) return;
  await applier.ensureBookkeeping();

  // Group migrations by their resolved component so applied lookups stay
  // accurate when callers override `component` per migration.
  const byComponent = new Map<string, ITabularMigration[]>();
  for (const m of migrations) {
    const c = m.component ?? defaultComponent;
    let bucket = byComponent.get(c);
    if (!bucket) {
      bucket = [];
      byComponent.set(c, bucket);
    }
    bucket.push(m);
  }

  for (const [component, group] of byComponent) {
    const sorted = [...group].sort((a, b) => a.version - b.version);
    const applied = await applier.appliedVersions(component);

    if (applied.size === 0 && !(await applier.tableExists())) {
      // Fresh-DB fast path: caller created the table at target; skip ops.
      await applier.markAllApplied(
        component,
        sorted.map((m) => ({ version: m.version, description: m.description }))
      );
      for (const m of sorted) {
        options.onProgress?.({
          component,
          version: m.version,
          phase: "completed",
          description: m.description,
          fraction: 1,
        });
      }
      continue;
    }

    for (const m of sorted) {
      if (applied.has(m.version)) continue;
      options.onProgress?.({
        component,
        version: m.version,
        phase: "starting",
        description: m.description,
      });
      try {
        await applier.applyMigration(
          component,
          m.version,
          m.description,
          m.ops,
          (fraction) => {
            options.onProgress?.({
              component,
              version: m.version,
              phase: "running",
              description: m.description,
              fraction,
            });
          }
        );
        options.onProgress?.({
          component,
          version: m.version,
          phase: "completed",
          description: m.description,
          fraction: 1,
        });
      } catch (err) {
        options.onProgress?.({
          component,
          version: m.version,
          phase: "failed",
          description: m.description,
          error: err,
        });
        throw err;
      }
    }
  }
}

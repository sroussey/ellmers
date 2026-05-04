/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMigration } from "./IMigration";

/**
 * Name of the bookkeeping table used by every runner. The leading underscore
 * is intentional — it sorts before user tables in catalog views and signals
 * "system table, don't touch".
 */
export const MIGRATIONS_TABLE = "_storage_migrations";

/**
 * Common runner contract — runs the supplied migrations in (component, version)
 * order, skipping any that have already been recorded. Returns the migrations
 * that were actually applied this call (useful for logging/tests).
 *
 * Concrete runners live in driver-specific packages (`@workglow/postgres`,
 * `@workglow/sqlite`) so that `@workglow/storage` does not have to depend on
 * any database driver.
 */
export interface IMigrationRunner<DB> {
  ensureBookkeepingTable(): Promise<void>;
  appliedVersions(component: string): Promise<Set<number>>;
  run(migrations: ReadonlyArray<IMigration<DB>>): Promise<ReadonlyArray<IMigration<DB>>>;
}

/**
 * Stable sort by `(component asc, version asc)`. Exposed so concrete runners
 * in driver packages don't need their own copy.
 */
export function sortMigrations<DB>(migrations: ReadonlyArray<IMigration<DB>>): IMigration<DB>[] {
  return [...migrations].sort((a, b) => {
    if (a.component !== b.component) return a.component < b.component ? -1 : 1;
    return a.version - b.version;
  });
}

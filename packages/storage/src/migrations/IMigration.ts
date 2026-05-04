/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A single, versioned, idempotent migration step.
 *
 * Migrations are addressed by `(component, version)`:
 *   - `component` groups migrations belonging to the same logical schema
 *     (e.g. `"queue:job_queue_tenant"`, `"rate-limiter"`, `"vector:chunks"`).
 *   - `version` is a monotonically increasing positive integer within a
 *     component. Versions MUST NOT be reused or renumbered after a release.
 *
 * The migration runner records each successfully applied `(component, version)`
 * pair in an internal `_storage_migrations` table and skips any that have
 * already been applied — so `up()` only runs once per environment.
 */
export interface IMigration<DB> {
  readonly component: string;
  readonly version: number;
  readonly description?: string;
  /** Apply the migration. Should be idempotent w.r.t. its own DDL. */
  up(db: DB): Promise<void> | void;
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Progress event emitted by {@link IMigrationRunner.run} as it works through
 * a migration set.
 *
 * `phase` semantics:
 *   - `"starting"` — `up()` is about to be invoked. `fraction` is `undefined`.
 *   - `"running"` — intra-migration tick; `fraction` (when present) is in
 *     `[0, 1]` reflecting how far along this single migration's `up()` is.
 *     Migrations are NOT required to emit running events; many are too short
 *     to be worth instrumenting. The runner does not synthesise them.
 *   - `"completed"` — `up()` and the bookkeeping write succeeded.
 *     `fraction` is `1`.
 *   - `"failed"` — `up()` or the bookkeeping write threw. `error` carries
 *     the thrown value. The runner re-throws after emitting; this event is
 *     for observability, not recovery.
 */
export interface MigrationProgressEvent {
  readonly component: string;
  readonly version: number;
  readonly phase: "starting" | "running" | "completed" | "failed";
  readonly description?: string;
  readonly fraction?: number;
  readonly error?: unknown;
}

/** Subscriber for {@link MigrationProgressEvent}s emitted by an {@link IMigrationRunner}. */
export type MigrationProgressListener = (event: MigrationProgressEvent) => void;

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
 *
 * `up()` may report intra-migration progress via `report` (a fraction in
 * `[0, 1]`). The runner forwards each `report` call to its
 * {@link MigrationProgressListener} as a `phase: "running"` event. Migrations
 * that aren't worth instrumenting can ignore the parameter.
 */
export interface IMigration<DB> {
  readonly component: string;
  readonly version: number;
  readonly description?: string;
  /** Apply the migration. Should be idempotent w.r.t. its own DDL. */
  up(db: DB, report?: (fraction: number) => void): Promise<void> | void;
}

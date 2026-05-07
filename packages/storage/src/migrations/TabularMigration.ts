/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import type { MigrationProgressListener } from "./IMigration";

/**
 * Backend-agnostic, declarative description of a single schema-evolution step.
 * Each op is translated to native operations by a per-backend
 * {@link ITabularMigrationApplier}.
 *
 * Ops within a single migration are applied in array order inside one atomic
 * unit (a `withTransaction` on SQL backends, an upgrade transaction on
 * IndexedDB, best-effort sequential on schemaless backends).
 */
export type TabularMigrationOp =
  | {
      readonly kind: "addColumn";
      readonly name: string;
      readonly schema: JsonSchema;
      readonly default?: string | number | boolean | null;
    }
  | { readonly kind: "dropColumn"; readonly name: string }
  | { readonly kind: "renameColumn"; readonly from: string; readonly to: string }
  | {
      readonly kind: "addIndex";
      readonly name: string;
      readonly columns: readonly string[];
      readonly unique?: boolean;
    }
  | { readonly kind: "dropIndex"; readonly name: string }
  | {
      readonly kind: "backfill";
      readonly batchSize?: number;
      readonly transform: (
        row: Record<string, unknown>
      ) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
    };

/**
 * One versioned migration for a tabular storage. Identified by
 * `(component, version)` like {@link IMigration}; bookkeeping shares
 * the existing `_storage_migrations` table.
 *
 * `component` defaults to `tabular:${storageName}` when omitted (the
 * orchestrator fills it in from the owning storage).
 */
export interface ITabularMigration {
  readonly component?: string;
  readonly version: number;
  readonly description?: string;
  readonly ops: ReadonlyArray<TabularMigrationOp>;
}

/**
 * Per-backend primitive that the orchestrator drives. A backend implements
 * `applyMigration` as an atomic unit (DDL + backfill + bookkeeping write
 * in one transaction where the backend supports it).
 *
 * `tableExists` is the freshness probe used by the orchestrator to decide
 * whether to take the fast path (CREATE + mark all migrations applied) or
 * the run-pending path.
 */
export interface ITabularMigrationApplier {
  ensureBookkeeping(): Promise<void>;
  appliedVersions(component: string): Promise<Set<number>>;
  tableExists(): Promise<boolean>;
  /**
   * Apply all ops AND record `(component, version)` in bookkeeping in one
   * atomic unit on backends with native transactions; best-effort sequential
   * on schemaless backends (DDL no-ops + backfill + bookkeeping write).
   */
  applyMigration(
    component: string,
    version: number,
    description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void>;
  /**
   * Mark all supplied `(component, version)` pairs as applied in bookkeeping
   * without running their ops. Used by the fresh-DB fast path.
   */
  markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void>;
}

export type TabularMigrationProgressListener = MigrationProgressListener;

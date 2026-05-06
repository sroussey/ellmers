/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMigration, IMigrationRunner } from "@workglow/storage";

/**
 * Records each invocation of a migration's `up()` callback. The contract
 * suite uses this to verify which migrations actually ran (orthogonal to
 * the runner's own bookkeeping table).
 */
export interface MigrationCallRecorder {
  readonly calls: ReadonlyArray<{ readonly component: string; readonly version: number }>;
  readonly record: (component: string, version: number) => void;
  readonly clear: () => void;
}

export function createMigrationCallRecorder(): MigrationCallRecorder {
  const calls: { component: string; version: number }[] = [];
  return {
    get calls() {
      return calls;
    },
    record: (component: string, version: number) => {
      calls.push({ component, version });
    },
    clear: () => {
      calls.length = 0;
    },
  };
}

export interface BuildMigrationOptions {
  /** When set, the migration's `up()` throws synchronously. */
  readonly fail?: boolean;
}

/**
 * Adapter-supplied factory that constructs a migration of the right
 * shape for the underlying DB (Postgres pool, SQLite database, or
 * IndexedDb upgrade context). The returned migration's `up()` calls the
 * recorder unless `opts.fail` is true.
 */
export type BuildMigrationFn<DB> = (
  component: string,
  version: number,
  recorder: MigrationCallRecorder,
  opts?: BuildMigrationOptions
) => IMigration<DB>;

export interface MigrationContractHandle<DB> {
  readonly createRunner: () => Promise<IMigrationRunner<DB>>;
  readonly buildMigration: BuildMigrationFn<DB>;
  readonly dispose: () => Promise<void>;
}

export interface MigrationRunnerContractOpts<DB> {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<MigrationContractHandle<DB>>;
  /**
   * Names of contract assertions currently broken in this adapter; each
   * named test wraps with itExpectFail. Known names:
   *   "appliesAndRecords"
   *   "idempotentRun"
   *   "incrementalApplication"
   *   "failedMigrationNotRecorded"
   *   "ensureBookkeepingIdempotent"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
}

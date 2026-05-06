/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../ai-provider/assertions/itExpectFail";
import {
  createMigrationCallRecorder,
  type MigrationContractHandle,
  type MigrationRunnerContractOpts,
} from "../types";

export function appliesAndRecordsBlock<DB>(
  opts: MigrationRunnerContractOpts<DB>,
  getHandle: () => MigrationContractHandle<DB>
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("appliesAndRecords") ? itExpectFail : it;

  describe("Applies and records", () => {
    itImpl(
      "first run applies all migrations in (component, version) order and records each version",
      async () => {
        const handle = getHandle();
        const runner = await handle.createRunner();
        const recorder = createMigrationCallRecorder();
        const component = `contract-applies-${Date.now()}`;
        const migrations = [
          handle.buildMigration(component, 2, recorder),
          handle.buildMigration(component, 1, recorder),
          handle.buildMigration(component, 3, recorder),
        ];

        const applied = await runner.run(migrations);

        expect(applied.length).toBe(3);
        expect(applied.map((m) => m.version)).toEqual([1, 2, 3]);
        expect(recorder.calls.map((c) => c.version)).toEqual([1, 2, 3]);
        const recordedVersions = await runner.appliedVersions(component);
        expect([...recordedVersions].sort()).toEqual([1, 2, 3]);
      },
      opts.timeout
    );
  });
}

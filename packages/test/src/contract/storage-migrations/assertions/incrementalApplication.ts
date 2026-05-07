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

export function incrementalApplicationBlock<DB>(
  opts: MigrationRunnerContractOpts<DB>,
  getHandle: () => MigrationContractHandle<DB>
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("incrementalApplication") ? itExpectFail : it;

  describe("Incremental application", () => {
    itImpl(
      "adding a new version to an already-migrated component runs only the new version",
      async () => {
        const handle = getHandle();
        const runner = await handle.createRunner();
        const recorder = createMigrationCallRecorder();
        const component = `contract-incremental-${Date.now()}`;

        await runner.run([
          handle.buildMigration(component, 1, recorder),
          handle.buildMigration(component, 2, recorder),
        ]);
        expect(recorder.calls.length).toBe(2);

        recorder.clear();
        const applied = await runner.run([
          handle.buildMigration(component, 1, recorder),
          handle.buildMigration(component, 2, recorder),
          handle.buildMigration(component, 3, recorder),
        ]);

        expect(applied.length).toBe(1);
        expect(applied[0].version).toBe(3);
        expect(recorder.calls.length).toBe(1);
        expect(recorder.calls[0].version).toBe(3);

        const recordedVersions = await runner.appliedVersions(component);
        expect([...recordedVersions].sort((a, b) => a - b)).toEqual([1, 2, 3]);
      },
      opts.timeout
    );

    itImpl(
      "appliedVersions returns numerically-sorted versions even past version 9",
      async () => {
        const handle = getHandle();
        const runner = await handle.createRunner();
        const recorder = createMigrationCallRecorder();
        const component = `contract-numeric-sort-${Date.now()}`;

        // Interleaved input — exercises both `sortMigrations` (which must
        // order numerically across the 1↔10 boundary) and the contract's
        // own assertion sort (which previously used the default
        // lexicographic comparator and silently allowed [1, 10, 2]).
        const applied = await runner.run([
          handle.buildMigration(component, 10, recorder),
          handle.buildMigration(component, 1, recorder),
          handle.buildMigration(component, 2, recorder),
        ]);

        expect(applied.map((m) => m.version)).toEqual([1, 2, 10]);
        expect(recorder.calls.map((c) => c.version)).toEqual([1, 2, 10]);
        const recordedVersions = await runner.appliedVersions(component);
        expect([...recordedVersions].sort((a, b) => a - b)).toEqual([1, 2, 10]);
      },
      opts.timeout
    );
  });
}

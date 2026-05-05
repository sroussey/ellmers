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
        expect([...recordedVersions].sort()).toEqual([1, 2, 3]);
      },
      opts.timeout
    );
  });
}

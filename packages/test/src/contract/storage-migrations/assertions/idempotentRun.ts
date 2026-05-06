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

export function idempotentRunBlock<DB>(
  opts: MigrationRunnerContractOpts<DB>,
  getHandle: () => MigrationContractHandle<DB>
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("idempotentRun") ? itExpectFail : it;

  describe("Idempotent run", () => {
    itImpl(
      "second run with the same migration set applies nothing and re-invokes no up()",
      async () => {
        const handle = getHandle();
        const runner = await handle.createRunner();
        const recorder = createMigrationCallRecorder();
        const component = `contract-idempotent-${Date.now()}`;
        const migrations = [
          handle.buildMigration(component, 1, recorder),
          handle.buildMigration(component, 2, recorder),
        ];

        const firstApplied = await runner.run(migrations);
        expect(firstApplied.length).toBe(2);
        expect(recorder.calls.length).toBe(2);

        recorder.clear();
        const secondApplied = await runner.run(migrations);
        expect(secondApplied.length).toBe(0);
        expect(recorder.calls.length).toBe(0);

        // Bookkeeping table still reports both versions.
        const recordedVersions = await runner.appliedVersions(component);
        expect([...recordedVersions].sort()).toEqual([1, 2]);
      },
      opts.timeout
    );
  });
}

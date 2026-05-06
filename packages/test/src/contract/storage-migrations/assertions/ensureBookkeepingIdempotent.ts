/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../ai-provider/assertions/itExpectFail";
import type { MigrationContractHandle, MigrationRunnerContractOpts } from "../types";

export function ensureBookkeepingIdempotentBlock<DB>(
  opts: MigrationRunnerContractOpts<DB>,
  getHandle: () => MigrationContractHandle<DB>
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("ensureBookkeepingIdempotent") ? itExpectFail : it;

  describe("Ensure bookkeeping idempotent", () => {
    itImpl(
      "calling ensureBookkeepingTable twice does not throw",
      async () => {
        const runner = await getHandle().createRunner();
        await runner.ensureBookkeepingTable();
        await expect(runner.ensureBookkeepingTable()).resolves.toBeUndefined();
      },
      opts.timeout
    );

    itImpl(
      "appliedVersions on a never-touched component returns an empty set",
      async () => {
        const runner = await getHandle().createRunner();
        await runner.ensureBookkeepingTable();
        const seen = await runner.appliedVersions(`never-touched-${Date.now()}`);
        expect(seen.size).toBe(0);
      },
      opts.timeout
    );
  });
}

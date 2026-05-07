/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../ai-provider/assertions/itExpectFail";
import type { WorkerProxyBoundaryOpts } from "../types";
import { runProviderTextGeneration } from "./providerCallHelpers";

const FAIL_KEY = "boundary.errorPropagation";

export function errorPropagationBlock(opts: WorkerProxyBoundaryOpts): void {
  const failing = opts.expectedFailures?.includes(FAIL_KEY) ?? false;
  const test = failing ? itExpectFail : it;

  describe("Worker-side throw surfaces on main thread", () => {
    test(
      "invalid model id rejects with a non-empty error",
      async () => {
        const bogus = `${opts.name.toLowerCase()}:__force_error__${Date.now()}`;
        await expect(
          runProviderTextGeneration(bogus, "ignored", {
            maxTokens: 4,
            timeoutMs: opts.timeout / 4,
          })
        ).rejects.toThrow(/.+/);
      },
      opts.timeout
    );

    if (opts.capabilities.errorPropagation) {
      test(
        "rejected error preserves a stack frame referencing worker code",
        async () => {
          const bogus = `${opts.name.toLowerCase()}:__force_error__${Date.now()}`;
          let captured: unknown;
          try {
            await runProviderTextGeneration(bogus, "ignored", {
              maxTokens: 4,
              timeoutMs: opts.timeout / 4,
            });
          } catch (err) {
            captured = err;
          }
          expect(captured).toBeInstanceOf(Error);
          const stack = (captured as Error).stack ?? "";
          expect(stack).toMatch(/JobRunFns|WorkerServer|worker_/);
        },
        opts.timeout
      );
    }
  });
}

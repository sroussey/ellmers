/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { browserOnlyStubBlock } from "./browserOnlyStub";
import type { WorkerProxyBoundaryOpts } from "./types";
import type { ConformanceHandle } from "../ai-provider/types";

export function runWorkerProxyBoundary(opts: WorkerProxyBoundaryOpts): void {
  if (opts.capabilities.browserOnly) {
    browserOnlyStubBlock(opts);
    return;
  }

  describe.skipIf(opts.skip)(`Worker-proxy boundary: ${opts.name}`, () => {
    let handle: ConformanceHandle | undefined;
    const getHandle = (): ConformanceHandle => {
      if (!handle) throw new Error("worker-proxy handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
      await handle.register();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    // Assertion blocks land in Phase 2 (Tasks 4–6).
    void getHandle;
  });
}

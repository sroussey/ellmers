/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { browserOnlyStubBlock } from "./browserOnlyStub";
import type { WorkerProxyBoundaryOpts } from "./types";
import type { ConformanceHandle } from "../ai-provider/types";
import { disposeTerminatesWorkerBlock } from "./assertions/disposeTerminatesWorker";
import { errorPropagationBlock } from "./assertions/errorPropagation";

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

    disposeTerminatesWorkerBlock(opts, getHandle);
    errorPropagationBlock(opts);
  });
}

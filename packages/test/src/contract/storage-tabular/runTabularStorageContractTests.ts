/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { subscribeCommitOrderBlock } from "./assertions/subscribeCommitOrder";
import { subscribeFireOnceBlock } from "./assertions/subscribeFireOnce";
import { vectorDimensionRoundTripBlock } from "./assertions/vectorDimensionRoundTrip";
import type { TabularContractHandle, TabularStorageContractOpts } from "./types";

export function runTabularStorageContractTests(opts: TabularStorageContractOpts): void {
  describe.skipIf(opts.skip)(`Tabular storage contract: ${opts.name}`, () => {
    let handle: TabularContractHandle | undefined;
    const getHandle = (): TabularContractHandle => {
      if (!handle) throw new Error("contract handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    subscribeFireOnceBlock(opts, getHandle);
    subscribeCommitOrderBlock(opts, getHandle);
    vectorDimensionRoundTripBlock(opts, getHandle);
  });
}

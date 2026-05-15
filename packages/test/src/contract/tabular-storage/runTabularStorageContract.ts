/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { countMatchesQueryBlock } from "./assertions/countMatchesQuery";
import { subscribeToChangesBlock } from "./assertions/subscribeToChanges";
import { vectorColumnFormatBlock } from "./assertions/vectorColumnFormat";
import { withTransactionRollbackBlock } from "./assertions/withTransactionRollback";
import type { TabularStorageContractOpts } from "./types";

export function runTabularStorageContract(opts: TabularStorageContractOpts): void {
  describe.skipIf(opts.skip)(`Tabular storage contract: ${opts.name}`, () => {
    subscribeToChangesBlock(opts);
    vectorColumnFormatBlock(opts);
    withTransactionRollbackBlock(opts);
    countMatchesQueryBlock(opts);
  });
}

export type { TabularStorageContractAssertion, TabularStorageContractOpts } from "./types";
export { VectorItemPrimaryKeyNames, VectorItemSchema } from "./types";

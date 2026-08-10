/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import { RunUsagePrimaryKeyNames, RunUsageSchema } from "@workglow/task-graph";

export { IndexedDbTaskGraphRepository } from "./IndexedDbTaskGraphRepository";
export { IndexedDbTaskOutputRepository } from "./IndexedDbTaskOutputRepository";

/** Sibling to the output cache above: persists each run's token accounting. */
export const runUsageStorage = new IndexedDbTabularStorage(
  "workglow-run-usage",
  RunUsageSchema,
  RunUsagePrimaryKeyNames
);

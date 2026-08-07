/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runTaskGraphRepositoryContract } from "@workglow/task-graph/test";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbTaskGraphRepository } from "../../binding/IndexedDbTaskGraphRepository";

describe("IndexedDbTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runTaskGraphRepositoryContract(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new IndexedDbTaskGraphRepository(table);
  });
});

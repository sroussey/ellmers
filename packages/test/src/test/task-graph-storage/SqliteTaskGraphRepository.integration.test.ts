/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { runTaskGraphRepositoryContract } from "@workglow/task-graph/test";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { SqliteTaskGraphRepository } from "../../binding/SqliteTaskGraphRepository";

describe("SqliteTaskGraphRepository", async () => {
  await Sqlite.init();
  let logger = getTestingLogger();
  setLogger(logger);
  runTaskGraphRepositoryContract(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new SqliteTaskGraphRepository(":memory:", table);
  });
});

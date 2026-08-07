/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { runTaskOutputRepositoryContract } from "@workglow/task-graph/test";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { SqliteTaskOutputRepository } from "../../binding/SqliteTaskOutputRepository";

describe("SqliteTaskOutputRepository", async () => {
  await Sqlite.init();
  let logger = getTestingLogger();
  setLogger(logger);
  runTaskOutputRepositoryContract(async () => {
    const id = uuid4().replace(/-/g, "_");
    const dbName = `task_output_test_${id}`;
    return new SqliteTaskOutputRepository(":memory:", dbName);
  });
});

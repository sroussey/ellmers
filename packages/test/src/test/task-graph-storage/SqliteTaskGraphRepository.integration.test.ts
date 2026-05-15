/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { SqliteTaskGraphRepository } from "../../binding/SqliteTaskGraphRepository";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";

describe("SqliteTaskGraphRepository", async () => {
  await Sqlite.init();
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphRepositoryTests(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new SqliteTaskGraphRepository(":memory:", table);
  });
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { SqliteModelRepository } from "../../binding/SqliteModelRepository";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";

describe("SqliteModelRepository", async () => {
  await Sqlite.init();

  let logger = getTestingLogger();
  setLogger(logger);
  runGenericModelRepositoryTests(async () => {
    const id = uuid4().replace(/-/g, "_");
    return new SqliteModelRepository(":memory:", `aimodel_test_${id}`);
  });
});

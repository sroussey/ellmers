/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteKvStorage } from "@workglow/sqlite/storage";
import { Sqlite } from "@workglow/sqlite/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("SqliteKvStorage", async () => {
  await Sqlite.init();
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericKvRepositoryTests(
    async (keyType, valueType) =>
      new SqliteKvStorage(":memory:", `sql_test_${uuid4().replace(/-/g, "_")}`, keyType, valueType)
  );
});

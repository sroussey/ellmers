/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite, SqliteKvStorage } from "@workglow/sqlite/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

describe("SqliteKvStorage", async () => {
  await Sqlite.init();
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericKvRepositoryTests(
    async (keyType, valueType) =>
      new SqliteKvStorage(":memory:", `sql_test_${uuid4().replace(/-/g, "_")}`, keyType, valueType)
  );
});

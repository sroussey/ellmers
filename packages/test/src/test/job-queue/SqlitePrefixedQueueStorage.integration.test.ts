/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SqliteQueueStorage } from "@workglow/sqlite/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import { setLogger } from "@workglow/util";
import { describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";

describe("SqlitePrefixedQueueStorage", async () => {
  await Sqlite.init();
  const db = new Sqlite.Database(":memory:");
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new SqliteQueueStorage(db, queueName, options)
  );
});

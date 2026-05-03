/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import { SqliteQueueStorage, SqliteRateLimiterStorage } from "@workglow/sqlite/job-queue";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("SqliteJobQueue", async () => {
  await Sqlite.init();
  const db = new Sqlite.Database(":memory:");
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericJobQueueTests(
    (queueName: string) => new SqliteQueueStorage(db, queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new SqliteRateLimiterStorage(db);
      await storage.setupDatabase();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});

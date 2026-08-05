/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { RateLimiter } from "@workglow/job-queue";
import { PostgresQueueStorage, PostgresRateLimiterStorage } from "@workglow/postgres/job-queue";
import { setLogger } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll, describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  runGenericJobQueueTests(
    (queueName: string) => new PostgresQueueStorage(db, queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new PostgresRateLimiterStorage(db);
      await storage.migrate();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});

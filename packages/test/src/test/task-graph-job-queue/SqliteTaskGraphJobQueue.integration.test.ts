/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import { SqliteQueueStorage } from "@workglow/sqlite/job-queue";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import { setLogger, uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { runGenericTaskGraphJobQueueTests, TestJob } from "./genericTaskGraphJobQueueTests";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("SqliteTaskGraphJobQueue", async () => {
  await Sqlite.init();
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphJobQueueTests(async () => {
    const db = new Sqlite.Database(":memory:");
    const queueName = `sqlite_test_queue_${uuid4()}`;
    const storage = new SqliteQueueStorage<TaskInput, TaskOutput>(db, queueName);
    await storage.setupDatabase();

    const server = new JobQueueServer<TaskInput, TaskOutput>(TestJob, {
      storage,
      queueName,
      limiter: new ConcurrencyLimiter(1),
      pollIntervalMs: 1,
    });

    const client = new JobQueueClient<TaskInput, TaskOutput>({
      storage,
      queueName,
    });

    client.attach(server);

    return { server, client, storage };
  });
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbQueueStorage } from "@workglow/indexeddb/job-queue";
import {
  InMemoryRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  RateLimiter,
} from "@workglow/job-queue";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import { setLogger, uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskGraphJobQueueTests, TestJob } from "./genericTaskGraphJobQueueTests";

describe("IndexedDbTaskGraphJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphJobQueueTests(async () => {
    const queueName = `idx_test_queue_${uuid4()}`;
    const storage = new IndexedDbQueueStorage<TaskInput, TaskOutput>(queueName);
    await storage.migrate();

    const server = new JobQueueServer<TaskInput, TaskOutput>(TestJob, {
      storage,
      queueName,
      limiter: new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
        maxExecutions: 1,
        windowSizeInSeconds: 10,
      }),
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

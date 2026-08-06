/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConcurrencyLimiter,
  InMemoryQueueStorage,
  JobQueueClient,
  JobQueueServer,
  wrapQueueStorage,
} from "@workglow/job-queue";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { setLogger, uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskGraphJobQueueTests, TestJob } from "./genericTaskGraphJobQueueTests";

describe("InMemoryTaskGraphJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphJobQueueTests(async () => {
    const queueName = `inMemory_test_queue_${uuid4()}`;
    const storage = new InMemoryQueueStorage<TaskInput, TaskOutput>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);

    const server = new JobQueueServer<TaskInput, TaskOutput>(TestJob, {
      messageQueue,
      jobStore,
      queueName,
      limiter: new ConcurrencyLimiter(1),
      pollIntervalMs: 1,
    });

    const client = new JobQueueClient<TaskInput, TaskOutput>({
      messageQueue,
      jobStore,
      queueName,
    });

    client.attach(server);

    return { server, client, storage };
  });
});

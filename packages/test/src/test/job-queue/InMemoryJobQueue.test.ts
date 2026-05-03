/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { InMemoryQueueStorage, InMemoryRateLimiterStorage } from "@workglow/job-queue";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("InMemoryJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericJobQueueTests(
    (queueName: string) => new InMemoryQueueStorage(queueName),
    (queueName: string, maxExecutions: number, windowSizeInSeconds: number) =>
      new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
        maxExecutions,
        windowSizeInSeconds,
      })
  );
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage, InMemoryRateLimiterStorage, RateLimiter } from "@workglow/job-queue";
import { setLogger } from "@workglow/util";
import { describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

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

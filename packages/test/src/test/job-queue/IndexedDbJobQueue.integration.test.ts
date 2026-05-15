/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";

import { IndexedDbQueueStorage, IndexedDbRateLimiterStorage } from "@workglow/indexeddb/job-queue";
import { RateLimiter } from "@workglow/job-queue";
import { setLogger } from "@workglow/util";
import { describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

describe("IndexedDbJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericJobQueueTests(
    (queueName: string) => new IndexedDbQueueStorage(queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new IndexedDbRateLimiterStorage();
      await storage.migrate();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    },
    {
      // fake-indexeddb under bun has read-after-write visibility lag that
      // breaks tests asserting wake-up under a long poll interval.
      skipFastWakeTests: true,
    }
  );
});

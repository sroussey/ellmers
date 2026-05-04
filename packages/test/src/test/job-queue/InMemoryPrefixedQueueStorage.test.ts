/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage } from "@workglow/job-queue";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";
import { runGenericQueueStorageSubscriptionTests } from "./genericQueueStorageSubscriptionTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("InMemoryPrefixedQueueStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new InMemoryQueueStorage(queueName, options)
  );

  runGenericQueueStorageSubscriptionTests(
    (queueName: string, options) => new InMemoryQueueStorage(queueName, options),
    { usesPolling: false, sharesStateAcrossInstances: false }
  );
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { SupabaseQueueStorage, SupabaseRateLimiterStorage } from "@workglow/supabase/job-queue";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const client = createSupabaseMockClient();

describe("SupabaseJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  afterAll(async () => {
    await client.close();
  });

  runGenericJobQueueTests(
    (queueName: string) => new SupabaseQueueStorage(client, queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new SupabaseRateLimiterStorage(client);
      await storage.migrate();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSupabaseQueue } from "@workglow/supabase/job-queue";
import { uuid4 } from "@workglow/util";
import { afterAll, describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runJobStoreExtensionTests } from "./JobStoreExtensions.test";

const RUN_SUPABASE_TESTS = process.env["RUN_SUPABASE_TESTS"] === "1";

const client = createSupabaseMockClient();

describe.skipIf(!RUN_SUPABASE_TESTS)("Supabase jobStore extensions (createSupabaseQueue)", () => {
  afterAll(async () => {
    await client.close();
  });

  runJobStoreExtensionTests({
    name: "Supabase",
    setup: async () => {
      const queueName = `test-supabase-ext-${uuid4()}`;
      const { jobStore, messageQueue } = createSupabaseQueue<{ value: string }, { result: string }>(
        queueName,
        client
      );
      await messageQueue.migrate();
      return {
        jobStore,
        queueName,
        dispose: async () => {
          await jobStore.deleteAll();
        },
      };
    },
  });
});

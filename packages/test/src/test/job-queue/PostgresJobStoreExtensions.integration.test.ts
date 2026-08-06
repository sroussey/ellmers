/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { createPostgresQueue } from "@workglow/postgres/job-queue";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll, describe } from "vitest";
import { runJobStoreExtensionTests } from "./JobStoreExtensions.test";

const RUN_POSTGRES_TESTS = process.env["RUN_POSTGRES_TESTS"] === "1";

const db = new PGlite() as unknown as Pool;

describe.skipIf(!RUN_POSTGRES_TESTS)("Postgres jobStore extensions (createPostgresQueue)", () => {
  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  runJobStoreExtensionTests({
    name: "Postgres",
    setup: async () => {
      const queueName = `test-pg-ext-${uuid4()}`;
      const { jobStore, messageQueue } = createPostgresQueue<{ value: string }, { result: string }>(
        queueName,
        db
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

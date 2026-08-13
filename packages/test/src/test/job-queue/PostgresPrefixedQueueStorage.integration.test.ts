/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresQueueStorage } from "@workglow/postgres/job-queue";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import type { Pool } from "pg";
import { afterAll, describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresPrefixedQueueStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new PostgresQueueStorage(db, queueName, options)
  );
});

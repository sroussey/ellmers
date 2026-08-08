/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresKvStorage } from "@workglow/postgres/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import type { Pool } from "pg";
import { afterAll, describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  runGenericKvRepositoryTests(async (keyType, valueType) => {
    const dbName = `pg_test_${uuid4().replace(/-/g, "_")}`;
    return new PostgresKvStorage(db, dbName, keyType, valueType);
  });
});

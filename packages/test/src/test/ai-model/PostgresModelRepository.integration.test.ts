/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { setLogger, uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll, describe } from "vitest";
import { PostgresModelRepository } from "../../binding/PostgresModelRepository";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";

const db = new PGlite() as unknown as Pool;

async function createPostgresModelRepository() {
  const id = uuid4().replace(/-/g, "_");
  return new PostgresModelRepository(db, `ai_model_test_${id}`);
}

describe("PostgresModelRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  runGenericModelRepositoryTests(createPostgresModelRepository);
});

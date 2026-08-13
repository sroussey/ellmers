/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `StreamingPostgresTaskOutputRepository` is a durable, server-side streaming
 * cache backing: JSON rows via `PostgresTabularStorage`, port payloads as
 * ordered `bytea` chunk rows via `TabularBlobChunkStore`. Exercised against an
 * in-process PGlite database (no external Postgres required).
 */

import { PGlite } from "@electric-sql/pglite";
import { runStreamingTaskOutputRepositoryContract } from "@workglow/task-graph/test";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll } from "vitest";
import { StreamingPostgresTaskOutputRepository } from "../../binding/StreamingPostgresTaskOutputRepository";

const db = new PGlite() as unknown as Pool;

afterAll(async () => {
  await (db as unknown as PGlite).close();
});

runStreamingTaskOutputRepositoryContract({
  name: "StreamingPostgresTaskOutputRepository",
  refScheme: "pgblob",
  foreignRefScheme: "idbblob",
  makeRepo: async () => {
    const table = `t_${uuid4().replace(/-/g, "_")}`;
    const repo = new StreamingPostgresTaskOutputRepository(db, table);
    await repo.setupDatabase();
    return { repo, table };
  },
  makeSibling: async (table) => {
    const sibling = new StreamingPostgresTaskOutputRepository(db, table);
    await sibling.setupDatabase();
    return sibling;
  },
});

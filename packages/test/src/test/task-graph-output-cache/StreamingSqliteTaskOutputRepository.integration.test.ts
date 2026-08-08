/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `StreamingSqliteTaskOutputRepository` is a durable, embedded streaming cache
 * backing: JSON rows via `SqliteTabularStorage`, port payloads as ordered BLOB
 * chunk rows via `TabularBlobChunkStore`. Exercised against an in-memory SQLite
 * database (better-sqlite3).
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { runStreamingTaskOutputRepositoryContract } from "@workglow/task-graph/test";
import { uuid4 } from "@workglow/util";
import { StreamingSqliteTaskOutputRepository } from "../../binding/StreamingSqliteTaskOutputRepository";

await Sqlite.init();
const db = new Sqlite.Database(":memory:");

runStreamingTaskOutputRepositoryContract({
  name: "StreamingSqliteTaskOutputRepository",
  refScheme: "sqliteblob",
  foreignRefScheme: "pgblob",
  makeRepo: async () => {
    const table = `t_${uuid4().replace(/-/g, "_")}`;
    const repo = new StreamingSqliteTaskOutputRepository(db, table);
    await repo.setupDatabase();
    return { repo, table };
  },
  makeSibling: async (table) => {
    const sibling = new StreamingSqliteTaskOutputRepository(db, table);
    await sibling.setupDatabase();
    return sibling;
  },
});

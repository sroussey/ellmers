/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sqlite } from "@workglow/sqlite/storage";
import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
} from "@workglow/task-graph";
import { TabularStreamingTaskOutputRepository } from "@workglow/task-graph/test";
import {
  BlobChunkPrimaryKeyNames,
  BlobChunkSchema,
  BlobManifestPrimaryKeyNames,
  BlobManifestSchema,
  TabularBlobChunkStore,
} from "./TabularBlobChunkStore";

/**
 * Durable, embedded (SQLite) streaming task-output repository. JSON rows via
 * {@link SqliteTabularStorage} (same as the non-streaming
 * `SqliteTaskOutputRepository`); streamed port payloads as ordered `BLOB` chunk
 * rows in sibling tables via {@link TabularBlobChunkStore}. Streaming behavior
 * lives in {@link TabularStreamingTaskOutputRepository}.
 *
 * Pass a shared {@link Sqlite.Database} handle so the rows and blob tables live
 * in one database (a `:memory:` path string would open a separate database per
 * table). Call {@link Sqlite.init} once before constructing.
 */
export class StreamingSqliteTaskOutputRepository extends TabularStreamingTaskOutputRepository {
  constructor(dbOrPath: string | Sqlite.Database, table: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new SqliteTabularStorage(dbOrPath, table, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
      blobs: new TabularBlobChunkStore(
        new SqliteTabularStorage(
          dbOrPath,
          `${table}_blob_chunks`,
          BlobChunkSchema,
          BlobChunkPrimaryKeyNames,
          ["createdAt"]
        ),
        new SqliteTabularStorage(
          dbOrPath,
          `${table}_blob_manifest`,
          BlobManifestSchema,
          BlobManifestPrimaryKeyNames,
          ["createdAt"]
        )
      ),
      scheme: "sqliteblob",
    });
  }
}

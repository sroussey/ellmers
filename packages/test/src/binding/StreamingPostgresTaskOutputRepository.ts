/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PostgresTabularStorage } from "@workglow/postgres/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
} from "@workglow/task-graph";
import { TabularStreamingTaskOutputRepository } from "@workglow/task-graph/test";
import type { Pool } from "pg";
import {
  BlobChunkPrimaryKeyNames,
  BlobChunkSchema,
  BlobManifestPrimaryKeyNames,
  BlobManifestSchema,
  TabularBlobChunkStore,
} from "./TabularBlobChunkStore";

/**
 * Durable, server-side (PostgreSQL) streaming task-output repository. JSON rows
 * via {@link PostgresTabularStorage}; streamed port payloads as ordered `bytea`
 * chunk rows in sibling tables via {@link TabularBlobChunkStore}. Streaming
 * behavior lives in {@link TabularStreamingTaskOutputRepository}.
 */
export class StreamingPostgresTaskOutputRepository extends TabularStreamingTaskOutputRepository {
  constructor(db: Pool, table: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new PostgresTabularStorage(db, table, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
      blobs: new TabularBlobChunkStore(
        new PostgresTabularStorage(
          db,
          `${table}_blob_chunks`,
          BlobChunkSchema,
          BlobChunkPrimaryKeyNames,
          ["createdAt"]
        ),
        new PostgresTabularStorage(
          db,
          `${table}_blob_manifest`,
          BlobManifestSchema,
          BlobManifestPrimaryKeyNames,
          ["createdAt"]
        )
      ),
      scheme: "pgblob",
    });
  }
}

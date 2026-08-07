/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseTabularStorage } from "@workglow/supabase/storage";
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
 * Durable, cloud (Supabase / PostgREST) streaming task-output repository. JSON
 * rows via {@link SupabaseTabularStorage}; streamed port payloads as ordered
 * `bytea` chunk rows in sibling tables via {@link TabularBlobChunkStore}.
 * Streaming behavior lives in {@link TabularStreamingTaskOutputRepository}.
 *
 * Production Supabase owns the schema through migrations; the tables here rely
 * on the `exec_sql` bootstrap path (local dev / test) to create themselves.
 */
export class StreamingSupabaseTaskOutputRepository extends TabularStreamingTaskOutputRepository {
  constructor(client: SupabaseClient, table: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new SupabaseTabularStorage(client, table, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
      blobs: new TabularBlobChunkStore(
        new SupabaseTabularStorage(
          client,
          `${table}_blob_chunks`,
          BlobChunkSchema,
          BlobChunkPrimaryKeyNames,
          ["createdAt"]
        ),
        new SupabaseTabularStorage(
          client,
          `${table}_blob_manifest`,
          BlobManifestSchema,
          BlobManifestPrimaryKeyNames,
          ["createdAt"]
        )
      ),
      scheme: "supablob",
    });
  }
}

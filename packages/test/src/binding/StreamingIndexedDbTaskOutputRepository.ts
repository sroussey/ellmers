/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
} from "@workglow/task-graph";
import { TabularStreamingTaskOutputRepository } from "@workglow/task-graph/test";
import { IdbBlobChunkStore } from "./IdbBlobChunkStore";

/**
 * Durable, browser-oriented streaming task-output repository. JSON output rows
 * are stored through {@link IndexedDbTabularStorage} (same as the non-streaming
 * `IndexedDbTaskOutputRepository`); streamed binary/text/object port payloads
 * are persisted as codec-encoded byte streams in a dedicated IndexedDB database
 * via {@link IdbBlobChunkStore}, referenced by a {@link CacheRef}. Streaming
 * behavior lives in {@link TabularStreamingTaskOutputRepository}.
 *
 * Two instances over the same `dbName` interoperate — the cross-instance read
 * contract. Because IndexedDB has no synchronous existence probe, the by-ref
 * readers are asynchronous; the runtime's `streamRefViaBacking` awaits them, so
 * a dangling ref still resolves to a cache miss.
 */
export class StreamingIndexedDbTaskOutputRepository extends TabularStreamingTaskOutputRepository {
  constructor(dbName: string = "task_outputs") {
    super({
      storage: tabularTaskOutputStorage(
        new IndexedDbTabularStorage(dbName, TaskOutputSchema, TaskOutputPrimaryKeyNames, [
          "createdAt",
        ])
      ),
      blobs: new IdbBlobChunkStore(dbName),
      scheme: "idbblob",
    });
  }
}

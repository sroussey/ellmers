/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbJobStore } from "./IndexedDbJobStore";
import { IndexedDbMessageQueue, type PendingIndexedDbWrite } from "./IndexedDbMessageQueue";
import { IndexedDbQueueStorage, type IndexedDbQueueStorageOptions } from "./IndexedDbQueueStorage";

/**
 * Factory for the paired IndexedDB message queue and job store. Both
 * facades share a single underlying {@link IndexedDbQueueStorage} so writes
 * through one are observable through the other.
 */
export function createIndexedDbQueue<Input, Output>(
  queueName: string,
  opts?: IndexedDbQueueStorageOptions
): {
  messageQueue: IndexedDbMessageQueue<Input, Output>;
  jobStore: IndexedDbJobStore<Input, Output>;
  /** @internal — exposed for callers that still need the legacy storage object. */
  core: IndexedDbQueueStorage<Input, Output>;
} {
  const core = new IndexedDbQueueStorage<Input, Output>(queueName, opts);
  const pending = new Map<unknown, PendingIndexedDbWrite<Output>>();
  return {
    messageQueue: new IndexedDbMessageQueue<Input, Output>(core, pending),
    jobStore: new IndexedDbJobStore<Input, Output>(core, pending),
    core,
  };
}

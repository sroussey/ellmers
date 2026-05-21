/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbJobStore } from "./IndexedDbJobStore";
import { IndexedDbMessageQueue } from "./IndexedDbMessageQueue";
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
} {
  const core = new IndexedDbQueueStorage<Input, Output>(queueName, opts);
  return {
    messageQueue: new IndexedDbMessageQueue<Input, Output>(core),
    jobStore: new IndexedDbJobStore<Input, Output>(core),
  };
}

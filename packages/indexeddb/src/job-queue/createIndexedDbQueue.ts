/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QueuePair } from "@workglow/job-queue";
import { wrapQueueStorage } from "@workglow/job-queue";
import { IndexedDbQueueStorage, type IndexedDbQueueStorageOptions } from "./IndexedDbQueueStorage";

/**
 * Factory for the paired IndexedDB message queue and job store. Both
 * facades share a single underlying {@link IndexedDbQueueStorage} so writes
 * through one are observable through the other.
 */
export function createIndexedDbQueue<Input, Output>(
  queueName: string,
  opts?: IndexedDbQueueStorageOptions
): QueuePair<Input, Output> {
  return wrapQueueStorage<Input, Output>(new IndexedDbQueueStorage<Input, Output>(queueName, opts));
}

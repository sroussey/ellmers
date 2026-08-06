/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage } from "./InMemoryQueueStorage";
import type { QueueStorageOptions } from "./IQueueStorage";
import type { QueuePair } from "./wrapQueueStorage";
import { wrapQueueStorage } from "./wrapQueueStorage";

/**
 * Factory for the paired in-memory message queue and job store. Both
 * facades share a single underlying {@link InMemoryQueueStorage} so writes
 * through one are observable through the other.
 */
export function createInMemoryQueue<Input, Output>(
  queueName: string = "default",
  opts?: QueueStorageOptions
): QueuePair<Input, Output> {
  return wrapQueueStorage<Input, Output>(new InMemoryQueueStorage<Input, Output>(queueName, opts));
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryJobStore } from "./InMemoryJobStore";
import { InMemoryMessageQueue } from "./InMemoryMessageQueue";
import { InMemoryQueueStorage } from "./InMemoryQueueStorage";
import type { QueueStorageOptions } from "./IQueueStorage";

/**
 * Factory for the paired in-memory message queue and job store. Both
 * facades share a single underlying {@link InMemoryQueueStorage} so writes
 * through one are observable through the other.
 */
export function createInMemoryQueue<Input, Output>(
  queueName: string = "default",
  opts?: QueueStorageOptions
): {
  messageQueue: InMemoryMessageQueue<Input, Output>;
  jobStore: InMemoryJobStore<Input, Output>;
} {
  const core = new InMemoryQueueStorage<Input, Output>(queueName, opts);
  return {
    messageQueue: new InMemoryMessageQueue<Input, Output>(core),
    jobStore: new InMemoryJobStore<Input, Output>(core),
  };
}

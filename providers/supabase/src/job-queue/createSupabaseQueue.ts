/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueuePair, QueueStorageOptions } from "@workglow/job-queue";
import { wrapQueueStorage } from "@workglow/job-queue";
import { SupabaseQueueStorage } from "./SupabaseQueueStorage";

/**
 * Factory for the paired Supabase message queue and job store. Both
 * facades share a single underlying {@link SupabaseQueueStorage} so writes
 * through one are observable through the other.
 */
export function createSupabaseQueue<Input, Output>(
  queueName: string,
  client: SupabaseClient,
  opts?: QueueStorageOptions
): QueuePair<Input, Output> {
  return wrapQueueStorage<Input, Output>(
    new SupabaseQueueStorage<Input, Output>(client, queueName, opts)
  );
}

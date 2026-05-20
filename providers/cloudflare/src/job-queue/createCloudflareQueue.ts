/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobStore, IMessageQueue, JobStorageFormat } from "@workglow/job-queue";
import { CloudflareMessageQueue } from "./CloudflareMessageQueue";
import type { CloudMessageBody } from "./types";

export interface CreateCloudflareQueueOptions<Input, Output> {
  readonly queue: Queue<CloudMessageBody>;
  readonly queueName: string;
  readonly jobStore: IJobStore<Input, Output>;
}

export interface CreateCloudflareQueueResult<Input, Output> {
  readonly messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  readonly jobStore: IJobStore<Input, Output>;
}

/**
 * Build a {@link CloudflareMessageQueue} paired with the caller-provided
 * {@link IJobStore}. The job store must be cluster-safe (e.g. backed by a
 * shared database reachable from every Worker isolate).
 */
export function createCloudflareQueue<Input, Output>(
  opts: CreateCloudflareQueueOptions<Input, Output>
): CreateCloudflareQueueResult<Input, Output> {
  return {
    messageQueue: new CloudflareMessageQueue<Input, Output>(opts),
    jobStore: opts.jobStore,
  };
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SQSClient } from "@aws-sdk/client-sqs";
import type { IJobStore, IMessageQueue, JobStorageFormat } from "@workglow/job-queue";
import { SqsMessageQueue } from "./SqsMessageQueue";

export interface CreateSqsQueueOptions<Input, Output> {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  readonly queueName: string;
  readonly jobStore: IJobStore<Input, Output>;
}

export interface CreateSqsQueueResult<Input, Output> {
  readonly messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  readonly jobStore: IJobStore<Input, Output>;
}

export function createSqsQueue<Input, Output>(
  opts: CreateSqsQueueOptions<Input, Output>
): CreateSqsQueueResult<Input, Output> {
  return {
    messageQueue: new SqsMessageQueue<Input, Output>(opts),
    jobStore: opts.jobStore,
  };
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SQSClient } from "@aws-sdk/client-sqs";
import type { IJobStore } from "@workglow/job-queue";

/**
 * SQS message body envelope. The full {@link JobStorageFormat} record lives
 * in the {@link IJobStore}; this envelope carries the id + advisory hints.
 */
export interface SqsMessageBody {
  readonly id: string;
  readonly attempts: number;
  readonly deadlineAt?: number;
}

export interface SqsQueueOptions<Input, Output> {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  readonly queueName: string;
  readonly jobStore: IJobStore<Input, Output>;
}

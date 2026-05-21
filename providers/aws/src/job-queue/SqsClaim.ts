/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type SQSClient,
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import {
  type ClaimFailOptions,
  type IClaim,
  type IJobStore,
  type JobRecord,
  type JobStorageFormat,
  type MessageId,
  JobStatus,
} from "@workglow/job-queue";

const SQS_MAX_VISIBILITY_FROM_FIRST_RECEIVE_MS = 12 * 60 * 60 * 1000;

export interface SqsClaimOptions<Input, Output> {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  readonly jobStore: IJobStore<Input, Output>;
  readonly record: JobRecord<Input, Output>;
  readonly receiptHandle: string;
  /**
   * Wall-clock ms when SQS first delivered this message to a consumer
   * (sourced from `ApproximateFirstReceiveTimestamp`). SQS caps a message's
   * cumulative in-flight time at 12h from first receive — exceeding it makes
   * the receipt handle expire and the message becomes available again.
   * Defaults to `Date.now()` if the attribute wasn't requested/available.
   */
  readonly firstReceivedAt?: number;
}

export class SqsClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  public readonly id: MessageId;
  public readonly body: JobStorageFormat<Input, Output>;
  public readonly attempts: number;

  private readonly sqs: SQSClient;
  private readonly queueUrl: string;
  private readonly jobStore: IJobStore<Input, Output>;
  private readonly receiptHandle: string;
  private readonly firstReceivedAt: number;

  constructor(opts: SqsClaimOptions<Input, Output>) {
    this.sqs = opts.sqs;
    this.queueUrl = opts.queueUrl;
    this.jobStore = opts.jobStore;
    this.receiptHandle = opts.receiptHandle;
    this.firstReceivedAt = opts.firstReceivedAt ?? Date.now();
    this.id = opts.record.id as MessageId;
    this.body = opts.record;
    this.attempts = opts.record.attempts ?? 0;
  }

  // Ordering note (ack/fail): DeleteMessage runs before the JobStore write.
  // If the store write throws, the SQS message is already gone — the row
  // stays PROCESSING but no redelivery is possible; the lease-expiry sweep
  // eventually marks it FAILED/PENDING. Reversing the order would risk
  // double-delivery, which is the worse failure mode.
  async ack(result?: unknown): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: this.receiptHandle,
      })
    );
    if (result !== undefined) {
      await this.jobStore.completeWithResult(this.id, result as Output);
    } else {
      await this.jobStore.saveStatus(this.id, JobStatus.COMPLETED);
    }
  }

  async fail(opts?: ClaimFailOptions): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: this.receiptHandle,
      })
    );
    await this.jobStore.failWithError(this.id, {
      error: opts?.error,
      errorCode: opts?.errorCode,
      abortRequested: opts?.abortRequested,
    });
  }

  async retry(opts?: { delaySeconds?: number }): Promise<void> {
    const seconds = Math.max(0, Math.ceil(opts?.delaySeconds ?? 0));
    await this.sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: this.receiptHandle,
        VisibilityTimeout: seconds,
      })
    );
  }

  async extendLease(ms: number): Promise<void> {
    const elapsed = Date.now() - this.firstReceivedAt;
    if (elapsed + ms > SQS_MAX_VISIBILITY_FROM_FIRST_RECEIVE_MS) {
      throw new RangeError(
        `SQS extendLease beyond 12h-from-first-receive (elapsed=${elapsed}ms, requested=${ms}ms)`
      );
    }
    const seconds = Math.ceil(ms / 1000);
    await this.sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: this.receiptHandle,
        VisibilityTimeout: seconds,
      })
    );
  }

  async disable(): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: this.receiptHandle,
      })
    );
    await this.jobStore.markDisabled(this.id);
  }
}

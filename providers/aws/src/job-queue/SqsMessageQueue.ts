/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type SQSClient,
  SendMessageBatchCommand,
  SendMessageCommand,
  type Message as SqsMessage,
} from "@aws-sdk/client-sqs";
import {
  type IClaim,
  type IJobStore,
  type IMessageQueue,
  type JobStorageFormat,
  type MessageId,
  type QueueStorageScope,
  type SendOptions,
} from "@workglow/job-queue";
import { uuid4 } from "@workglow/util";
import { SqsClaim } from "./SqsClaim";
import type { SqsMessageBody, SqsQueueOptions } from "./types";

const SQS_MAX_DELAY_SECONDS = 900;
const SQS_BATCH_SIZE = 10;
const SQS_MAX_RECEIVE = 10;

export class SqsMessageQueue<Input, Output> implements IMessageQueue<
  JobStorageFormat<Input, Output>
> {
  public readonly scope: QueueStorageScope = "cluster";

  private readonly sqs: SQSClient;
  private readonly queueUrl: string;
  private readonly queueName: string;
  private readonly jobStore: IJobStore<Input, Output>;

  constructor(opts: SqsQueueOptions<Input, Output>) {
    this.sqs = opts.sqs;
    this.queueUrl = opts.queueUrl;
    this.queueName = opts.queueName;
    this.jobStore = opts.jobStore;
  }

  async send(body: JobStorageFormat<Input, Output>, opts: SendOptions = {}): Promise<MessageId> {
    if (opts.delaySeconds != null && opts.delaySeconds > SQS_MAX_DELAY_SECONDS) {
      throw new RangeError(
        `SQS send delaySeconds=${opts.delaySeconds} exceeds the 900-second maximum`
      );
    }
    if (opts.fingerprint) {
      const existing = await this.jobStore.findActiveByFingerprint(
        opts.fingerprint,
        this.queueName
      );
      if (existing?.id != null) return existing.id as MessageId;
    }

    const id = await this.jobStore.create(body, opts);
    const envelope: SqsMessageBody = {
      id: String(id),
      attempts: 0,
      deadlineAt: opts.timeoutSeconds != null ? Date.now() + opts.timeoutSeconds * 1000 : undefined,
    };
    try {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(envelope),
          DelaySeconds: opts.delaySeconds,
        })
      );
      return id;
    } catch (err) {
      await this.jobStore.failWithError(id, {
        error: err instanceof Error ? err.message : String(err),
        errorCode: "ENQUEUE_FAILED",
        abortRequested: false,
      });
      throw err;
    }
  }

  async sendBatch(
    bodies: readonly JobStorageFormat<Input, Output>[],
    opts: SendOptions = {}
  ): Promise<readonly MessageId[]> {
    if (opts.delaySeconds != null && opts.delaySeconds > SQS_MAX_DELAY_SECONDS) {
      throw new RangeError(`SQS sendBatch delaySeconds exceeds the 900-second maximum`);
    }
    const ids: MessageId[] = [];
    for (const body of bodies) {
      let resolvedId: MessageId | undefined;
      if (opts.fingerprint) {
        const existing = await this.jobStore.findActiveByFingerprint(
          opts.fingerprint,
          this.queueName
        );
        if (existing?.id != null) resolvedId = existing.id as MessageId;
      }
      if (resolvedId == null) resolvedId = await this.jobStore.create(body, opts);
      ids.push(resolvedId);
    }

    const failures: { id: MessageId; err: unknown }[] = [];
    for (let start = 0; start < ids.length; start += SQS_BATCH_SIZE) {
      const slice = ids.slice(start, start + SQS_BATCH_SIZE);
      const entries = slice.map((id) => ({
        Id: uuid4(),
        MessageBody: JSON.stringify({ id: String(id), attempts: 0 } satisfies SqsMessageBody),
        DelaySeconds: opts.delaySeconds,
      }));
      try {
        const res = await this.sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: entries,
          })
        );
        for (const f of res.Failed ?? []) {
          const idx = entries.findIndex((e) => e.Id === f.Id);
          if (idx >= 0) {
            failures.push({
              id: slice[idx]!,
              err: new Error(f.Message ?? "sqs failure"),
            });
          }
        }
      } catch (err) {
        for (const id of slice) failures.push({ id, err });
      }
    }

    for (const { id, err } of failures) {
      await this.jobStore.failWithError(id, {
        error: err instanceof Error ? err.message : String(err),
        errorCode: "ENQUEUE_FAILED",
        abortRequested: false,
      });
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => (f.err instanceof Error ? f.err : new Error(String(f.err)))),
        `SQS sendBatch had ${failures.length} failure(s)`
      );
    }
    return ids;
  }

  async receive(opts: {
    workerId: string;
    leaseMs: number;
    max?: number;
  }): Promise<readonly IClaim<JobStorageFormat<Input, Output>>[]> {
    const max = Math.min(SQS_MAX_RECEIVE, opts.max ?? 1);
    const res = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: max,
        VisibilityTimeout: Math.ceil(opts.leaseMs / 1000),
        WaitTimeSeconds: 0,
        MessageSystemAttributeNames: ["SentTimestamp"],
      })
    );
    const messages: SqsMessage[] = res.Messages ?? [];
    if (messages.length === 0) return [];

    const parsed = messages.map((m) => ({
      message: m,
      envelope: JSON.parse(m.Body!) as SqsMessageBody,
    }));
    const records = await this.jobStore.getMany(parsed.map((p) => p.envelope.id));

    const claims: SqsClaim<Input, Output>[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const record = records[i];
      const entry = parsed[i]!;
      const { message } = entry;
      if (!record) {
        try {
          await this.sqs.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: message.ReceiptHandle!,
            })
          );
        } catch {
          // best-effort
        }
        // eslint-disable-next-line no-console
        console.warn(`[SqsMessageQueue] orphan message id=${entry.envelope.id} acked`);
        continue;
      }
      const sentTimestamp = message.Attributes?.SentTimestamp;
      claims.push(
        new SqsClaim<Input, Output>({
          sqs: this.sqs,
          queueUrl: this.queueUrl,
          jobStore: this.jobStore,
          record,
          receiptHandle: message.ReceiptHandle!,
          sentAt: sentTimestamp ? Number(sentTimestamp) : undefined,
        })
      );
    }
    return claims;
  }

  /**
   * Best-effort no-op. SQS receipt handles aren't tracked by job id after the
   * claim is created; the normal path uses {@link SqsClaim.retry} /
   * {@link SqsClaim.fail}. SQS will redeliver after the visibility timeout
   * regardless, so dropping a claim on the floor is safe.
   */
  async releaseClaim(_id: MessageId): Promise<void> {
    // intentionally empty
  }

  async migrate(): Promise<void> {
    // SQS has no schema to migrate.
  }

  getMigrations(): ReadonlyArray<unknown> {
    return [];
  }
}

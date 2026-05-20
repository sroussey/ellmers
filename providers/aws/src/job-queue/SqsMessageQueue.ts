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
  JobStatus,
  type JobStorageFormat,
  type MessageId,
  type QueueStorageScope,
  type SendOptions,
} from "@workglow/job-queue";
import { getLogger, uuid4 } from "@workglow/util";
import { SqsClaim } from "./SqsClaim";
import type { SqsMessageBody, SqsQueueOptions } from "./types";

const SQS_MAX_DELAY_SECONDS = 900;
const SQS_BATCH_SIZE = 10;
const SQS_MAX_RECEIVE = 10;
/**
 * Backoff applied to `visible_at` when an enqueue throws transiently. Keeps
 * the row PENDING so a subsequent producer retry / poll picks it up again
 * instead of marking it FAILED on the first network blip. See H4.
 */
const ENQUEUE_DEFER_BACKOFF_MS = 30_000;

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
      // H4: a producer-side throw is transient — leave the row PENDING so a
      // retry or a polling consumer can pick it back up. We shift visible_at
      // forward and stamp error_code; status/attempts are untouched.
      await this.jobStore.markEnqueueDeferred(id, {
        visible_at: new Date(Date.now() + ENQUEUE_DEFER_BACKOFF_MS),
        errorCode: "ENQUEUE_FAILED",
      });
      throw err;
    }
  }

  async sendBatch(
    bodies: readonly JobStorageFormat<Input, Output>[],
    opts: SendOptions = {}
  ): Promise<readonly MessageId[]> {
    // H3: applying a single fingerprint to a whole batch is almost always a
    // bug — every body would dedup against the first row, returning the same
    // id for distinct payloads. Force callers that want fingerprint-based
    // dedup to use per-body send() instead.
    if (opts.fingerprint != null) {
      throw new RangeError(
        "sendBatch does not accept a single fingerprint applied to all bodies; use send() per body for fingerprinted dedup"
      );
    }
    if (opts.delaySeconds != null && opts.delaySeconds > SQS_MAX_DELAY_SECONDS) {
      throw new RangeError(`SQS sendBatch delaySeconds exceeds the 900-second maximum`);
    }
    const ids: MessageId[] = [];
    for (const body of bodies) {
      const resolvedId = await this.jobStore.create(body, opts);
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

    if (failures.length > 0) {
      // H4: transient — keep every failed row PENDING with visible_at pushed
      // forward and error_code set, instead of FAILING (which would
      // permanently drop the work for any consumer that's polling for
      // PENDING). Successful rows in the batch keep their original PENDING +
      // visible_at = now from create().
      const defer = new Date(Date.now() + ENQUEUE_DEFER_BACKOFF_MS);
      for (const { id } of failures) {
        await this.jobStore.markEnqueueDeferred(id, {
          visible_at: defer,
          errorCode: "ENQUEUE_FAILED",
        });
      }
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

    // H1: parse each envelope individually inside a try/catch so a single
    // malformed body cannot poison the whole batch. Malformed messages get
    // best-effort DeleteMessage'd + warned and the loop continues with the
    // survivors. We log only the messageId + error.message (NEVER the body)
    // because bodies may contain user payloads / PII.
    const parsed: { message: SqsMessage; envelope: SqsMessageBody }[] = [];
    for (const m of messages) {
      let envelope: SqsMessageBody;
      try {
        envelope = JSON.parse(m.Body!) as SqsMessageBody;
      } catch (err) {
        try {
          await this.sqs.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: m.ReceiptHandle!,
            })
          );
        } catch {
          // best-effort
        }
        getLogger().warn(
          `[SqsMessageQueue] dropping malformed message messageId=${m.MessageId ?? "?"}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        continue;
      }
      parsed.push({ message: m, envelope });
    }
    if (parsed.length === 0) return [];

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
        getLogger().warn(`[SqsMessageQueue] orphan message id=${entry.envelope.id} acked`);
        continue;
      }
      // C2: SQS guarantees at-least-once delivery, so a successfully ack'd
      // (COMPLETED/FAILED/DISABLED) row can still be redelivered while the
      // visibility window expires or after a network blip on DeleteMessage.
      // If we dispatch that claim through the worker, validateJobState throws
      // a PermanentJobError which the non-retryable branch routes to
      // failJob → claim.fail → failWithError, overwriting the original
      // terminal status. Skip and best-effort delete here at the dispatch
      // boundary so the worker never sees the redelivery. The fix is
      // intentionally not duplicated in SqsClaim.fail — keeping a single
      // entry point makes the contract easier to reason about.
      if (
        record.status === JobStatus.COMPLETED ||
        record.status === JobStatus.FAILED ||
        record.status === JobStatus.DISABLED
      ) {
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
        getLogger().warn(
          `[SqsMessageQueue] dropping terminal-status redelivery id=${entry.envelope.id} status=${record.status}`
        );
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

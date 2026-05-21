/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IClaim,
  IMessageQueue,
  JobStorageFormat,
  MessageId,
  QueueChangePayload,
  QueueStorageScope,
  QueueSubscribeOptions,
  SendOptions,
} from "@workglow/job-queue";
import { JobStatus } from "@workglow/job-queue";
import { SqliteQueueStorage } from "./SqliteQueueStorage";

class SqliteClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  constructor(
    private readonly core: SqliteQueueStorage<Input, Output>,
    public readonly id: MessageId,
    public readonly body: JobStorageFormat<Input, Output>,
    public readonly attempts: number,
    private readonly workerId: string
  ) {}

  async ack(result?: unknown): Promise<void> {
    const current = (await this.core.get(this.id)) ?? this.body;
    const output = result !== undefined ? result : (current.output ?? null);
    await this.core.finalize(this.id, {
      output: output as Output | null,
      error: null,
      error_code: null,
      status: JobStatus.COMPLETED,
      completed_at: current.completed_at ?? new Date().toISOString(),
    });
  }

  async retry(opts?: { delaySeconds?: number }): Promise<void> {
    const delay = opts?.delaySeconds ?? 0;
    const current = (await this.core.get(this.id)) ?? this.body;
    await this.core.complete({
      ...current,
      status: JobStatus.PENDING,
      lease_owner: null,
      lease_expires_at: null,
      visible_at: new Date(Date.now() + delay * 1000).toISOString(),
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }

  async fail(opts?: {
    error?: string | null;
    errorCode?: string | null;
    abortRequested?: boolean;
    permanent?: boolean;
  }): Promise<void> {
    void opts?.permanent;
    const current = (await this.core.get(this.id)) ?? this.body;
    const error = opts?.error !== undefined ? opts.error : (current.error ?? null);
    const errorCode = opts?.errorCode !== undefined ? opts.errorCode : (current.error_code ?? null);
    const abortRequested = opts?.abortRequested === true;
    await this.core.finalize(this.id, {
      error,
      error_code: errorCode,
      abort_requested_at: abortRequested
        ? (current.abort_requested_at ?? new Date().toISOString())
        : (current.abort_requested_at ?? null),
      status: JobStatus.FAILED,
      completed_at: current.completed_at ?? new Date().toISOString(),
    });
  }

  async extendLease(ms: number): Promise<void> {
    await this.core.extendLease(this.id, this.workerId, ms);
  }

  async disable(): Promise<void> {
    const current = await this.core.get(this.id);
    const completedAt = current?.completed_at ?? new Date().toISOString();
    await this.core.finalize(this.id, {
      status: JobStatus.DISABLED,
      completed_at: completedAt,
      lease_owner: null,
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }
}

export class SqliteMessageQueue<Input, Output> implements IMessageQueue<
  JobStorageFormat<Input, Output>
> {
  public readonly scope: QueueStorageScope = "process";

  /** @internal — shared with the paired job store */
  public readonly core: SqliteQueueStorage<Input, Output>;

  constructor(core: SqliteQueueStorage<Input, Output>) {
    this.core = core;
  }

  async send(body: JobStorageFormat<Input, Output>, opts?: SendOptions): Promise<MessageId> {
    return this.core.add(applySendOptions(body, opts));
  }

  async sendBatch(
    bodies: readonly JobStorageFormat<Input, Output>[],
    opts?: SendOptions
  ): Promise<readonly MessageId[]> {
    const ids: MessageId[] = [];
    for (const body of bodies) {
      ids.push(await this.send(body, opts));
    }
    return ids;
  }

  async receive(opts: {
    workerId: string;
    leaseMs: number;
    max?: number;
  }): Promise<readonly IClaim<JobStorageFormat<Input, Output>>[]> {
    const max = Math.max(1, opts.max ?? 1);
    const claims: IClaim<JobStorageFormat<Input, Output>>[] = [];
    while (claims.length < max) {
      const job = await this.core.next(opts.workerId, { leaseMs: opts.leaseMs });
      if (!job) break;
      claims.push(
        new SqliteClaim<Input, Output>(this.core, job.id, job, job.attempts ?? 0, opts.workerId)
      );
    }
    return claims;
  }

  async releaseClaim(id: MessageId): Promise<void> {
    await this.core.releaseClaim(id);
  }

  async migrate(): Promise<void> {
    await this.core.migrate();
  }

  getMigrations(): ReadonlyArray<unknown> {
    return this.core.getMigrations();
  }

  subscribeToChanges(
    callback: (change: QueueChangePayload<any, any>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    return this.core.subscribeToChanges(callback, options);
  }
}

function applySendOptions<Input, Output>(
  body: JobStorageFormat<Input, Output>,
  opts?: SendOptions
): JobStorageFormat<Input, Output> {
  if (!opts) return body;
  const out: JobStorageFormat<Input, Output> = { ...body };
  if (opts.delaySeconds != null) {
    out.visible_at = new Date(Date.now() + opts.delaySeconds * 1000).toISOString();
  }
  if (opts.timeoutSeconds != null) {
    out.deadline_at = new Date(Date.now() + opts.timeoutSeconds * 1000).toISOString();
  }
  if (opts.fingerprint != null) out.fingerprint = opts.fingerprint;
  if (opts.jobRunId != null) out.job_run_id = opts.jobRunId;
  if (opts.maxAttempts != null) out.max_attempts = opts.maxAttempts;
  return out;
}

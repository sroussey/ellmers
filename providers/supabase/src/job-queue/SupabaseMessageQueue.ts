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
import type { SupabaseQueueStorage } from "./SupabaseQueueStorage";

/**
 * Per-id buffer that lets {@link IJobStore.saveResult}/{@link IJobStore.saveError}
 * stage output/error until the terminal claim.ack()/fail() persists them in
 * a single complete() call (avoids double-bumping `attempts`).
 */
export type PendingWrite<Output> = {
  output?: Output | null;
  error?: string | null;
  errorCode?: string | null;
  abortRequested?: boolean;
};

class SupabaseClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  constructor(
    private readonly core: SupabaseQueueStorage<Input, Output>,
    private readonly pending: Map<unknown, PendingWrite<Output>>,
    public readonly id: MessageId,
    public readonly body: JobStorageFormat<Input, Output>,
    public readonly attempts: number,
    private readonly workerId: string
  ) {}

  async ack(): Promise<void> {
    const buf = this.pending.get(this.id);
    this.pending.delete(this.id);
    const current = (await this.core.get(this.id)) ?? this.body;
    await this.core.complete({
      ...current,
      output: buf?.output ?? current.output ?? null,
      error: null,
      error_code: null,
      status: "COMPLETED",
      completed_at: current.completed_at ?? new Date().toISOString(),
      progress: 100,
      progress_message: "",
      progress_details: null,
    });
  }

  async retry(opts?: { delaySeconds?: number }): Promise<void> {
    this.pending.delete(this.id);
    const delay = opts?.delaySeconds ?? 0;
    const current = (await this.core.get(this.id)) ?? this.body;
    await this.core.complete({
      ...current,
      status: "PENDING",
      lease_owner: null,
      lease_expires_at: null,
      visible_at: new Date(Date.now() + delay * 1000).toISOString(),
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }

  async fail(_opts?: { permanent?: boolean }): Promise<void> {
    const buf = this.pending.get(this.id);
    this.pending.delete(this.id);
    const current = (await this.core.get(this.id)) ?? this.body;
    await this.core.complete({
      ...current,
      error: buf?.error ?? current.error ?? null,
      error_code: buf?.errorCode ?? current.error_code ?? null,
      abort_requested_at: buf?.abortRequested
        ? (current.abort_requested_at ?? new Date().toISOString())
        : (current.abort_requested_at ?? null),
      status: "FAILED",
      completed_at: current.completed_at ?? new Date().toISOString(),
      progress: 100,
      progress_message: "",
      progress_details: null,
    });
  }

  async extendLease(ms: number): Promise<void> {
    await this.core.extendLease(this.id, this.workerId, ms);
  }
}

export class SupabaseMessageQueue<Input, Output> implements IMessageQueue<
  JobStorageFormat<Input, Output>
> {
  public readonly scope: QueueStorageScope;

  /** @internal — shared with the paired job store */
  public readonly core: SupabaseQueueStorage<Input, Output>;

  /** @internal — shared transient buffer for saveResult/saveError. */
  private readonly pending: Map<unknown, PendingWrite<Output>>;

  constructor(
    core: SupabaseQueueStorage<Input, Output>,
    pending: Map<unknown, PendingWrite<Output>>
  ) {
    this.core = core;
    this.pending = pending;
    this.scope = core.scope;
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
    const job = await this.core.next(opts.workerId, { leaseMs: opts.leaseMs });
    if (!job) return [];
    return [
      new SupabaseClaim<Input, Output>(
        this.core,
        this.pending,
        job.id,
        job,
        job.attempts ?? 0,
        opts.workerId
      ),
    ];
  }

  async releaseClaim(id: MessageId): Promise<void> {
    this.pending.delete(id);
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

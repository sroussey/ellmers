/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IClaim } from "./IClaim";
import type { IJobStore, JobRecord } from "./IJobStore";
import type { IMessageQueue, MessageId, SendOptions } from "./IMessageQueue";
import type {
  IQueueStorage,
  JobStatus,
  JobStorageFormat,
  QueueChangePayload,
  QueueSubscribeOptions,
} from "./IQueueStorage";

/**
 * Transient per-id buffer of outputs / errors written via
 * {@link IJobStore.saveResult} / {@link IJobStore.saveError} ahead of the
 * terminal {@link IClaim.ack} / {@link IClaim.fail} that actually persists
 * the row. Folding both into a single legacy `storage.complete(...)` call
 * avoids double-incrementing the `attempts` counter on backends whose
 * `complete()` always bumps it.
 */
type PendingWrite<Output> = {
  output?: Output | null;
  error?: string | null;
  errorCode?: string | null;
  abortRequested?: boolean;
};

class WrappedClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  constructor(
    private readonly storage: IQueueStorage<Input, Output>,
    private readonly pending: Map<unknown, PendingWrite<Output>>,
    public readonly id: MessageId,
    public readonly body: JobStorageFormat<Input, Output>,
    public readonly attempts: number,
    private readonly workerId: string
  ) {}

  async ack(): Promise<void> {
    const buf = this.pending.get(this.id);
    this.pending.delete(this.id);
    const current = (await this.storage.get(this.id)) ?? this.body;
    await this.storage.complete({
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
    const visibleAt = new Date(Date.now() + delay * 1000).toISOString();
    const current = (await this.storage.get(this.id)) ?? this.body;
    await this.storage.complete({
      ...current,
      status: "PENDING",
      lease_owner: null,
      lease_expires_at: null,
      visible_at: visibleAt,
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }

  async fail(opts?: { permanent?: boolean }): Promise<void> {
    void opts;
    const buf = this.pending.get(this.id);
    this.pending.delete(this.id);
    const current = (await this.storage.get(this.id)) ?? this.body;
    await this.storage.complete({
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
    await this.storage.extendLease(this.id, this.workerId, ms);
  }
}

class WrappedMessageQueue<Input, Output> implements IMessageQueue<JobStorageFormat<Input, Output>> {
  public get scope() {
    return this.storage.scope;
  }

  constructor(
    private readonly storage: IQueueStorage<Input, Output>,
    private readonly pending: Map<unknown, PendingWrite<Output>>
  ) {}

  async send(body: JobStorageFormat<Input, Output>, opts?: SendOptions): Promise<MessageId> {
    const job = applySendOptions(body, opts);
    return this.storage.add(job);
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
      const next = await this.storage.next(opts.workerId, { leaseMs: opts.leaseMs });
      if (!next) break;
      claims.push(
        new WrappedClaim<Input, Output>(
          this.storage,
          this.pending,
          next.id,
          next,
          next.attempts ?? 0,
          opts.workerId
        )
      );
    }
    return claims;
  }

  async releaseClaim(id: MessageId): Promise<void> {
    this.pending.delete(id);
    await this.storage.releaseClaim(id);
  }

  async migrate(): Promise<void> {
    await this.storage.migrate();
  }

  getMigrations(): ReadonlyArray<unknown> {
    return this.storage.getMigrations();
  }

  subscribeToChanges(
    callback: (change: QueueChangePayload<any, any>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    return this.storage.subscribeToChanges(callback, options);
  }
}

class WrappedJobStore<Input, Output> implements IJobStore<Input, Output> {
  constructor(
    private readonly storage: IQueueStorage<Input, Output>,
    private readonly pending: Map<unknown, PendingWrite<Output>>
  ) {}

  get(id: MessageId): Promise<JobRecord<Input, Output> | undefined> {
    return this.storage.get(id);
  }
  async peek(status?: JobStatus, num?: number): Promise<readonly JobRecord<Input, Output>[]> {
    return this.storage.peek(status, num);
  }
  size(status?: JobStatus): Promise<number> {
    return this.storage.size(status);
  }
  async getByRunId(runId: string): Promise<readonly JobRecord<Input, Output>[]> {
    return this.storage.getByRunId(runId);
  }
  outputForInput(input: Input): Promise<Output | null> {
    return this.storage.outputForInput(input);
  }
  async saveProgress(
    id: MessageId,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void> {
    await this.storage.saveProgress(id, progress, message, details);
  }
  async saveResult(id: MessageId, output: Output): Promise<void> {
    // Buffered until claim.ack() persists it. Calling storage.complete() here
    // would double-bump `attempts` on backends whose complete() increments it.
    const buf = this.pending.get(id) ?? {};
    buf.output = output ?? null;
    this.pending.set(id, buf);
  }
  async saveError(
    id: MessageId,
    error: string,
    errorCode: string | null,
    abortRequested: boolean
  ): Promise<void> {
    const buf = this.pending.get(id) ?? {};
    buf.error = error;
    buf.errorCode = errorCode;
    buf.abortRequested = abortRequested;
    this.pending.set(id, buf);
  }
  async deleteByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    await this.storage.deleteJobsByStatusAndAge(status, olderThanMs);
  }
  async delete(id: MessageId): Promise<void> {
    this.pending.delete(id);
    await this.storage.delete(id);
  }
  async deleteAll(): Promise<void> {
    this.pending.clear();
    await this.storage.deleteAll();
  }
  async abort(id: MessageId): Promise<void> {
    await this.storage.abort(id);
  }

  async saveStatus(id: MessageId, status: JobStatus): Promise<void> {
    const current = await this.storage.get(id);
    if (!current) return;
    // Re-use complete() but preserve attempts by subtracting 1 to offset the
    // mandatory increment in legacy storage backends.
    await this.storage.complete({ ...current, status, attempts: (current.attempts ?? 1) - 1 });
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

export function wrapQueueStorage<Input, Output>(
  storage: IQueueStorage<Input, Output>
): {
  messageQueue: IMessageQueue<JobStorageFormat<Input, Output>>;
  jobStore: IJobStore<Input, Output>;
} {
  const pending = new Map<unknown, PendingWrite<Output>>();
  return {
    messageQueue: new WrappedMessageQueue(storage, pending),
    jobStore: new WrappedJobStore(storage, pending),
  };
}

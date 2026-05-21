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

class WrappedClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  constructor(
    private readonly storage: IQueueStorage<Input, Output>,
    public readonly id: MessageId,
    public readonly body: JobStorageFormat<Input, Output>,
    public readonly attempts: number,
    private readonly workerId: string
  ) {}

  async ack(result?: unknown): Promise<void> {
    const current = (await this.storage.get(this.id)) ?? this.body;
    const output = result !== undefined ? result : (current.output ?? null);
    await this.storage.finalize(this.id, {
      // `output` cast — finalize is typed against Output but receives the
      // result the worker passed in; the queue body's Output and the claim's
      // Output align by construction.
      output: output as never,
      error: null,
      error_code: null,
      status: "COMPLETED",
      completed_at: current.completed_at ?? new Date().toISOString(),
    });
  }

  async retry(opts?: { delaySeconds?: number }): Promise<void> {
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
      // Clear abort_requested_at on retry — an abort flag set during the
      // failed attempt must not survive into the next retry.
      abort_requested_at: null,
    });
  }

  async fail(opts?: {
    error?: string | null;
    errorCode?: string | null;
    abortRequested?: boolean;
    permanent?: boolean;
  }): Promise<void> {
    void opts?.permanent; // hint — worker owns retry-vs-fail decision
    const current = (await this.storage.get(this.id)) ?? this.body;
    const error = opts?.error !== undefined ? opts.error : (current.error ?? null);
    const errorCode = opts?.errorCode !== undefined ? opts.errorCode : (current.error_code ?? null);
    const abortRequested = opts?.abortRequested === true;
    await this.storage.finalize(this.id, {
      error,
      error_code: errorCode,
      abort_requested_at: abortRequested
        ? (current.abort_requested_at ?? new Date().toISOString())
        : (current.abort_requested_at ?? null),
      status: "FAILED",
      completed_at: current.completed_at ?? new Date().toISOString(),
    });
  }

  async extendLease(ms: number): Promise<void> {
    await this.storage.extendLease(this.id, this.workerId, ms);
  }

  async disable(): Promise<void> {
    const current = await this.storage.get(this.id);
    const completedAt = current?.completed_at ?? new Date().toISOString();
    await this.storage.finalize(this.id, {
      status: "DISABLED",
      completed_at: completedAt,
      lease_owner: null,
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }
}

class WrappedMessageQueue<Input, Output> implements IMessageQueue<JobStorageFormat<Input, Output>> {
  public get scope() {
    return this.storage.scope;
  }

  constructor(private readonly storage: IQueueStorage<Input, Output>) {}

  async send(body: JobStorageFormat<Input, Output>, opts?: SendOptions): Promise<MessageId> {
    const job = applySendOptions(body, opts);
    return this.storage.add(job);
  }

  async sendBatch(
    bodies: readonly JobStorageFormat<Input, Output>[],
    opts?: SendOptions
  ): Promise<readonly MessageId[]> {
    // A single fingerprint applied to a whole batch is almost always a bug —
    // every body would dedup against the first row, returning the same id for
    // distinct payloads. Mirrors the guard in SqsMessageQueue /
    // CloudflareMessageQueue so the contract is uniform across adapters.
    if (opts?.fingerprint != null) {
      throw new RangeError(
        "sendBatch does not accept a single fingerprint applied to all bodies; use send() per body for fingerprinted dedup"
      );
    }
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
  constructor(private readonly storage: IQueueStorage<Input, Output>) {}

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
  async deleteByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    await this.storage.deleteJobsByStatusAndAge(status, olderThanMs);
  }
  async delete(id: MessageId): Promise<void> {
    await this.storage.delete(id);
  }
  async deleteAll(): Promise<void> {
    await this.storage.deleteAll();
  }
  async abort(id: MessageId): Promise<void> {
    await this.storage.abort(id);
  }

  async saveStatus(id: MessageId, status: JobStatus): Promise<void> {
    // Use finalize() so the status write does not bump attempts.
    await this.storage.finalize(id, { status });
  }

  async create(body: JobStorageFormat<Input, Output>, opts: SendOptions): Promise<MessageId> {
    const job = applySendOptions(body, opts);
    return this.storage.add(job);
  }

  async findActiveByFingerprint(
    fingerprint: string,
    _queueName: string
  ): Promise<JobRecord<Input, Output> | undefined> {
    // The wrapped storage is already scoped to a single queue, so any
    // PENDING/PROCESSING row found here is in "this" queue. The queueName
    // parameter is accepted for interface compatibility but not used for
    // filtering — the storage instance boundary provides the scope.
    const [pending, processing] = await Promise.all([
      this.storage.peek("PENDING"),
      this.storage.peek("PROCESSING"),
    ]);
    return [...pending, ...processing].find((j) => j.fingerprint === fingerprint);
  }

  async getMany(
    ids: readonly MessageId[]
  ): Promise<readonly (JobRecord<Input, Output> | undefined)[]> {
    return Promise.all(ids.map((id) => this.storage.get(id)));
  }

  async completeWithResult(id: MessageId, result: Output): Promise<void> {
    await this.storage.finalize(id, {
      output: result,
      error: null,
      error_code: null,
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
    });
  }

  async failWithError(
    id: MessageId,
    opts: {
      readonly error?: string | null;
      readonly errorCode?: string | null;
      readonly abortRequested?: boolean;
    }
  ): Promise<void> {
    const current = await this.storage.get(id);
    const now = new Date().toISOString();
    const abortRequestedAt =
      opts.abortRequested === true
        ? (current?.abort_requested_at ?? now)
        : (current?.abort_requested_at ?? null);
    await this.storage.finalize(id, {
      ...("error" in opts ? { error: opts.error ?? null } : {}),
      ...("errorCode" in opts ? { error_code: opts.errorCode ?? null } : {}),
      abort_requested_at: abortRequestedAt,
      status: "FAILED",
      completed_at: current?.completed_at ?? now,
    });
  }

  async markEnqueueDeferred(
    id: MessageId,
    opts: { readonly visible_at: Date; readonly errorCode: string }
  ): Promise<void> {
    await this.storage.finalize(id, {
      visible_at: opts.visible_at.toISOString(),
      error_code: opts.errorCode,
    });
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
  return {
    messageQueue: new WrappedMessageQueue(storage),
    jobStore: new WrappedJobStore(storage),
  };
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IClaim } from "./IClaim";
import type { IMessageQueue, MessageId, SendOptions } from "./IMessageQueue";
import { InMemoryQueueStorage } from "./InMemoryQueueStorage";
import type {
  JobStorageFormat,
  QueueChangePayload,
  QueueStorageScope,
  QueueSubscribeOptions,
} from "./IQueueStorage";

class InMemoryClaim<Input, Output> implements IClaim<JobStorageFormat<Input, Output>> {
  constructor(
    private readonly core: InMemoryQueueStorage<Input, Output>,
    public readonly id: MessageId,
    public readonly body: JobStorageFormat<Input, Output>,
    public readonly attempts: number,
    private readonly workerId: string
  ) {}

  async ack(result?: unknown): Promise<void> {
    const current = (await this.core.get(this.id)) ?? this.body;
    // Do not fall back to current.output — that's the prior attempt's value
    // and finalize() must overwrite it on every ack. Matches WrappedClaim.ack
    // so the ack(undefined) contract is identical across every IQueueStorage
    // backend (in-memory vs wrapped cloud/IndexedDB).
    const output = result !== undefined ? result : null;
    await this.core.finalize(this.id, {
      output: output as Output | null,
      error: null,
      error_code: null,
      status: "COMPLETED",
      completed_at: current.completed_at ?? new Date().toISOString(),
    });
  }

  async retry(opts?: { delaySeconds?: number }): Promise<void> {
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

  async fail(opts?: {
    error?: string | null;
    errorCode?: string | null;
    abortRequested?: boolean;
    permanent?: boolean;
  }): Promise<void> {
    void opts?.permanent;
    const current = (await this.core.get(this.id)) ?? this.body;
    // Do not fall back to current.error / current.error_code — those are the
    // prior attempt's values and finalize() must overwrite them on every fail.
    // Matches WrappedClaim.fail so the contract is identical across backends.
    const error = opts?.error !== undefined ? opts.error : null;
    const errorCode = opts?.errorCode !== undefined ? opts.errorCode : null;
    const abortRequested = opts?.abortRequested === true;
    await this.core.finalize(this.id, {
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
    await this.core.extendLease(this.id, this.workerId, ms);
  }

  /**
   * Atomic disable: one storage write — status=DISABLED, lease released,
   * progress cleared.
   */
  async disable(): Promise<void> {
    const current = await this.core.get(this.id);
    const completedAt = current?.completed_at ?? new Date().toISOString();
    await this.core.finalize(this.id, {
      status: "DISABLED",
      completed_at: completedAt,
      lease_owner: null,
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }
}

export class InMemoryMessageQueue<Input, Output> implements IMessageQueue<
  JobStorageFormat<Input, Output>
> {
  public readonly scope: QueueStorageScope = "process";

  /** @internal — shared with the paired job store */
  public readonly core: InMemoryQueueStorage<Input, Output>;

  constructor(core: InMemoryQueueStorage<Input, Output>) {
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
        new InMemoryClaim<Input, Output>(this.core, job.id, job, job.attempts ?? 0, opts.workerId)
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

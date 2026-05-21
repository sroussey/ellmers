/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IJobStore,
  JobRecord,
  JobStatus,
  JobStorageFormat,
  MessageId,
  SendOptions,
} from "@workglow/job-queue";
import type { IndexedDbQueueStorage } from "./IndexedDbQueueStorage";

export class IndexedDbJobStore<Input, Output> implements IJobStore<Input, Output> {
  /** @internal — shared with the paired message queue */
  public readonly core: IndexedDbQueueStorage<Input, Output>;

  constructor(core: IndexedDbQueueStorage<Input, Output>) {
    this.core = core;
  }

  get(id: MessageId): Promise<JobRecord<Input, Output> | undefined> {
    return this.core.get(id);
  }

  async peek(status?: JobStatus, num?: number): Promise<readonly JobRecord<Input, Output>[]> {
    return this.core.peek(status as any, num);
  }

  size(status?: JobStatus): Promise<number> {
    return this.core.size(status as any);
  }

  async getByRunId(runId: string): Promise<readonly JobRecord<Input, Output>[]> {
    return this.core.getByRunId(runId);
  }

  outputForInput(input: Input): Promise<Output | null> {
    return this.core.outputForInput(input);
  }

  async saveProgress(
    id: MessageId,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void> {
    await this.core.saveProgress(id, progress, message, details);
  }

  async deleteByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    await this.core.deleteJobsByStatusAndAge(status, olderThanMs);
  }

  async delete(id: MessageId): Promise<void> {
    await this.core.delete(id);
  }

  async deleteAll(): Promise<void> {
    await this.core.deleteAll();
  }

  async abort(id: MessageId): Promise<void> {
    await this.core.abort(id);
  }

  async saveStatus(id: MessageId, status: JobStatus): Promise<void> {
    await this.core.saveStatus(id, status);
  }

  async create(body: JobStorageFormat<Input, Output>, opts: SendOptions): Promise<MessageId> {
    const enriched = {
      ...body,
      fingerprint: opts.fingerprint ?? body.fingerprint,
      job_run_id: opts.jobRunId ?? body.job_run_id,
      max_attempts: opts.maxAttempts ?? body.max_attempts,
      deadline_at:
        opts.timeoutSeconds != null
          ? new Date(Date.now() + opts.timeoutSeconds * 1000).toISOString()
          : body.deadline_at,
    } as JobStorageFormat<Input, Output>;
    return this.core.add(enriched);
  }

  async findActiveByFingerprint(
    fingerprint: string,
    _queueName: string
  ): Promise<JobRecord<Input, Output> | undefined> {
    const [pending, processing] = await Promise.all([
      this.core.peek("PENDING" as any),
      this.core.peek("PROCESSING" as any),
    ]);
    return [...pending, ...processing].find((j) => j.fingerprint === fingerprint);
  }

  async getMany(
    ids: readonly MessageId[]
  ): Promise<readonly (JobRecord<Input, Output> | undefined)[]> {
    return Promise.all(ids.map((id) => this.core.get(id)));
  }

  async completeWithResult(id: MessageId, result: Output): Promise<void> {
    await this.core.finalize(id, {
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
    const current = await this.core.get(id);
    const now = new Date().toISOString();
    const abortRequestedAt =
      opts.abortRequested === true
        ? (current?.abort_requested_at ?? now)
        : (current?.abort_requested_at ?? null);
    await this.core.finalize(id, {
      ...("error" in opts ? { error: opts.error ?? null } : {}),
      ...("errorCode" in opts ? { error_code: opts.errorCode ?? null } : {}),
      abort_requested_at: abortRequestedAt,
      status: "FAILED",
      completed_at: current?.completed_at ?? now,
    });
  }

  async markDisabled(id: MessageId): Promise<void> {
    const current = await this.core.get(id);
    const completedAt = current?.completed_at ?? new Date().toISOString();
    await this.core.finalize(id, {
      status: "DISABLED",
      completed_at: completedAt,
      lease_owner: null,
      progress: 0,
      progress_message: "",
      progress_details: null,
    });
  }

  async markEnqueueDeferred(
    id: MessageId,
    opts: { readonly visible_at: Date; readonly errorCode: string }
  ): Promise<void> {
    await this.core.finalize(id, {
      visible_at: opts.visible_at.toISOString(),
      error_code: opts.errorCode,
    });
  }
}

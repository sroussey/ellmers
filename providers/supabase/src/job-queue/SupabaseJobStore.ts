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
import type { SupabaseQueueStorage } from "./SupabaseQueueStorage";

export class SupabaseJobStore<Input, Output> implements IJobStore<Input, Output> {
  /** @internal — shared with the paired message queue */
  public readonly core: SupabaseQueueStorage<Input, Output>;

  constructor(core: SupabaseQueueStorage<Input, Output>) {
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
    await this.core.saveProgress(id, progress, message, details as Record<string, any>);
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
    queueName: string
  ): Promise<JobRecord<Input, Output> | undefined> {
    return this.core.findActiveByFingerprint(fingerprint, queueName);
  }

  async getMany(
    ids: readonly MessageId[]
  ): Promise<readonly (JobRecord<Input, Output> | undefined)[]> {
    return this.core.getMany(ids);
  }

  async completeWithResult(id: MessageId, result: Output): Promise<void> {
    await this.core.completeWithResult(id, result);
  }

  async failWithError(
    id: MessageId,
    opts: {
      readonly error?: string | null;
      readonly errorCode?: string | null;
      readonly abortRequested?: boolean;
    }
  ): Promise<void> {
    await this.core.failWithError(id, opts);
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

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobStore, JobRecord } from "./IJobStore";
import type { MessageId } from "./IMessageQueue";
import type { PendingInMemoryWrite } from "./InMemoryMessageQueue";
import { InMemoryQueueStorage } from "./InMemoryQueueStorage";
import type { JobStatus } from "./IQueueStorage";

export class InMemoryJobStore<Input, Output> implements IJobStore<Input, Output> {
  /** @internal — shared with the paired message queue */
  public readonly core: InMemoryQueueStorage<Input, Output>;

  /** @internal — shared transient buffer for saveResult/saveError. */
  private readonly pending: Map<unknown, PendingInMemoryWrite<Output>>;

  constructor(
    core: InMemoryQueueStorage<Input, Output>,
    pending: Map<unknown, PendingInMemoryWrite<Output>>
  ) {
    this.core = core;
    this.pending = pending;
  }

  get(id: MessageId): Promise<JobRecord<Input, Output> | undefined> {
    return this.core.get(id);
  }

  async peek(status?: JobStatus, num?: number): Promise<readonly JobRecord<Input, Output>[]> {
    return this.core.peek(status, num);
  }

  size(status?: JobStatus): Promise<number> {
    return this.core.size(status);
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

  async saveResult(id: MessageId, output: Output): Promise<void> {
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
    await this.core.deleteJobsByStatusAndAge(status, olderThanMs);
  }

  async delete(id: MessageId): Promise<void> {
    this.pending.delete(id);
    await this.core.delete(id);
  }

  async deleteAll(): Promise<void> {
    this.pending.clear();
    await this.core.deleteAll();
  }

  async abort(id: MessageId): Promise<void> {
    await this.core.abort(id);
  }
}

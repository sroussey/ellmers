/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { traced } from "../util/traced";
import type {
  IQueueStorage,
  JobStatus,
  JobStorageFormat,
  QueueChangePayload,
  QueueSubscribeOptions,
} from "./IQueueStorage";

/**
 * Telemetry wrapper for any IQueueStorage implementation.
 * Creates spans for all queue storage operations.
 */
export class TelemetryQueueStorage<Input, Output> implements IQueueStorage<Input, Output> {
  constructor(
    private readonly storageName: string,
    private readonly inner: IQueueStorage<Input, Output>
  ) {}

  add(job: JobStorageFormat<Input, Output>): Promise<unknown> {
    return traced("workglow.storage.queue.add", this.storageName, () => this.inner.add(job));
  }
  get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> {
    return traced("workglow.storage.queue.get", this.storageName, () => this.inner.get(id));
  }
  next(workerId: string): Promise<JobStorageFormat<Input, Output> | undefined> {
    return traced("workglow.storage.queue.next", this.storageName, () => this.inner.next(workerId));
  }
  peek(status?: JobStatus, num?: number): Promise<Array<JobStorageFormat<Input, Output>>> {
    return traced("workglow.storage.queue.peek", this.storageName, () =>
      this.inner.peek(status, num)
    );
  }
  size(status?: JobStatus): Promise<number> {
    return traced("workglow.storage.queue.size", this.storageName, () => this.inner.size(status));
  }
  complete(job: JobStorageFormat<Input, Output>): Promise<void> {
    return traced("workglow.storage.queue.complete", this.storageName, () =>
      this.inner.complete(job)
    );
  }
  release(id: unknown): Promise<void> {
    return traced("workglow.storage.queue.release", this.storageName, () => this.inner.release(id));
  }
  deleteAll(): Promise<void> {
    return traced("workglow.storage.queue.deleteAll", this.storageName, () =>
      this.inner.deleteAll()
    );
  }
  outputForInput(input: Input): Promise<Output | null> {
    return traced("workglow.storage.queue.outputForInput", this.storageName, () =>
      this.inner.outputForInput(input)
    );
  }
  abort(id: unknown): Promise<void> {
    return traced("workglow.storage.queue.abort", this.storageName, () => this.inner.abort(id));
  }
  getByRunId(runId: string): Promise<Array<JobStorageFormat<Input, Output>>> {
    return traced("workglow.storage.queue.getByRunId", this.storageName, () =>
      this.inner.getByRunId(runId)
    );
  }
  saveProgress(
    id: unknown,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void> {
    return traced("workglow.storage.queue.saveProgress", this.storageName, () =>
      this.inner.saveProgress(id, progress, message, details)
    );
  }
  delete(id: unknown): Promise<void> {
    return traced("workglow.storage.queue.delete", this.storageName, () => this.inner.delete(id));
  }
  deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    return traced("workglow.storage.queue.deleteJobsByStatusAndAge", this.storageName, () =>
      this.inner.deleteJobsByStatusAndAge(status, olderThanMs)
    );
  }
  setupDatabase(): Promise<void> {
    return this.inner.setupDatabase();
  }
  subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    return this.inner.subscribeToChanges(callback, options);
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, EventEmitter, EventParameters } from "@workglow/util";
import type { CacheRef } from "../cache/CacheRef";
import { TaskInput, TaskOutput } from "../task/TaskTypes";

export const TASK_OUTPUT_REPOSITORY = createServiceToken<TaskOutputRepository>(
  "taskgraph.taskOutputRepository"
);

export type TaskOutputEventListeners = {
  output_saved: (taskType: string) => void;
  output_retrieved: (taskType: string) => void;
  output_cleared: () => void;
  output_pruned: () => void;
};

export type TaskOutputEvents = keyof TaskOutputEventListeners;

export type TaskOutputEventListener<Event extends TaskOutputEvents> =
  TaskOutputEventListeners[Event];

export type TaskOutputEventParameters<Event extends TaskOutputEvents> = EventParameters<
  TaskOutputEventListeners,
  Event
>;

/**
 * Abstract class for managing task outputs in a repository
 * Provides methods for saving, retrieving, and clearing task outputs
 */
export abstract class TaskOutputRepository {
  outputCompression: boolean;

  constructor({ outputCompression = true }) {
    this.outputCompression = outputCompression;
  }

  private get events() {
    if (!this._events) {
      this._events = new EventEmitter<TaskOutputEventListeners>();
    }
    return this._events;
  }
  private _events: EventEmitter<TaskOutputEventListeners> | undefined;

  on<Event extends TaskOutputEvents>(name: Event, fn: TaskOutputEventListener<Event>) {
    this.events.on(name, fn);
  }

  off<Event extends TaskOutputEvents>(name: Event, fn: TaskOutputEventListener<Event>) {
    this.events.off(name, fn);
  }

  waitOn<Event extends TaskOutputEvents>(name: Event) {
    return this.events.waitOn(name) as Promise<TaskOutputEventParameters<Event>>;
  }

  emit<Event extends TaskOutputEvents>(name: Event, ...args: TaskOutputEventParameters<Event>) {
    this._events?.emit(name, ...args);
  }

  /**
   * Persist a task output keyed by `(taskType, fingerprint(inputs))`.
   *
   * Backing implementations upsert by primary key (last-writer-wins). For
   * deterministic cache entries (`CachePolicy.kind === "deterministic"`) this
   * is benign because all writers produce equal values. Run-private writes
   * are single-writer-per-runId in practice (one worker per run), so the
   * upsert behavior is also fine there.
   */
  abstract saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt?: Date // for testing purposes
  ): Promise<void>;

  /**
   * OPTIONAL streaming sink. Implementations that can ingest a byte stream
   * without materializing the full payload (e.g. a file-backed cache) declare
   * this method; the runner pipes `binary-delta` chunks straight to it. The
   * default base class does NOT implement it — call `supportsStreaming()` to
   * branch. `metadata` carries side-band data (e.g. HTTP response headers).
   *
   * Returns a {@link CacheRef} that the runner places into `Output` at the
   * binary port slot when the reference threshold is met. The `$ref` string is
   * opaque; only this repository (and any wrapping namespacer like
   * {@link RunPrivateCacheRepo}) needs to know how to decode it via
   * {@link getOutputByRef} / {@link getOutputStreamByRef}.
   *
   * Implementations that provide `saveOutputStream` MUST also provide
   * `getOutputByRef` (and ideally `getOutputStreamByRef`); a ref written by
   * one without a paired reader is unresolvable.
   */
  saveOutputStream?(
    taskType: string,
    inputs: TaskInput,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef>;

  /**
   * OPTIONAL reader counterpart of {@link saveOutputStream}. Resolves a
   * {@link CacheRef} previously produced by `saveOutputStream` to a `Blob`.
   * Returns `undefined` on cache miss (TTL expiry, manual clear). The runner
   * never calls this directly; consumers calling `JobHandle.result()` or
   * `resolveOutput` reach it through the resolver layer.
   */
  getOutputByRef?(ref: CacheRef): Promise<Blob | undefined>;

  /**
   * OPTIONAL streaming reader counterpart of {@link saveOutputStream}. Returns
   * an async iterable of bytes for the referenced entry, or `undefined` when
   * the entry is absent or this backing does not support streaming retrieval.
   */
  getOutputStreamByRef?(ref: CacheRef): AsyncIterable<Uint8Array> | undefined;

  /** True when this repository implements `saveOutputStream`. */
  supportsStreaming(): boolean {
    return typeof this.saveOutputStream === "function";
  }

  abstract getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined>;

  abstract clear(): Promise<void>;

  abstract size(): Promise<number>;

  abstract clearOlderThan(olderThanInMs: number): Promise<void>;

  /**
   * Whether entries written to this repository will survive a process crash / restart.
   *
   * Used by the task runner to warn when `kind: "private"` tasks are configured with a
   * non-durable backing store (e.g., in-memory) — restart-survival, which is the whole
   * point of the private cache tier, will not actually work in that case.
   */
  abstract isDurable(): boolean;

  /**
   * Delete every entry whose `taskType` starts with `prefix`. Used by
   * `RunPrivateCacheRepo.clearRun()` to delete entries for a specific `runId`.
   *
   * Default implementation throws — backing repositories that support run-private
   * caching MUST override this.
   */
  async deleteByTaskTypePrefix(_prefix: string): Promise<void> {
    throw new Error(
      `${this.constructor.name}: deleteByTaskTypePrefix is not supported by this repository.`
    );
  }

  /**
   * Delete entries whose `taskType` starts with `prefix` and were created more
   * than `olderThanMs` ago. Used by `CacheJanitor.sweepStaleRunPrivate()`.
   *
   * Default implementation throws — backing repositories that support periodic
   * janitor sweeps of run-private rows MUST override this.
   */
  async clearOlderThanWithTaskTypePrefix(_prefix: string, _olderThanMs: number): Promise<void> {
    throw new Error(
      `${this.constructor.name}: clearOlderThanWithTaskTypePrefix is not supported by this repository.`
    );
  }

  /**
   * Count entries whose `taskType` starts with `prefix`. Used by
   * `RunPrivateCacheRepo.size()` so the wrapper's count reflects only its own
   * namespaced view rather than the entire backing store.
   *
   * Default implementation throws — backing repositories that support run-private
   * caching MUST override this.
   */
  async sizeByTaskTypePrefix(_prefix: string): Promise<number> {
    throw new Error(
      `${this.constructor.name}: sizeByTaskTypePrefix is not supported by this repository.`
    );
  }
}

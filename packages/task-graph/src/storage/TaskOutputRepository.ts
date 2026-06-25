/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, EventEmitter, EventParameters } from "@workglow/util";
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
   * Run-scoped write for the private cache: persist an entry under a specific
   * `runId`. Used by {@link RunPrivateCacheRepo} so the run id is a first-class
   * column (indexed) rather than a `taskType` prefix.
   *
   * Default implementation throws — only run-private backing repositories
   * (e.g. `RunPrivateTaskOutputRepository`) implement it.
   */
  async saveOutputForRun(
    _runId: string,
    _taskType: string,
    _inputs: TaskInput,
    _output: TaskOutput,
    _createdAt?: Date
  ): Promise<void> {
    throw new Error(
      `${this.constructor.name}: saveOutputForRun is not supported by this repository.`
    );
  }

  /** Run-scoped read counterpart to {@link saveOutputForRun}. Default throws. */
  async getOutputForRun(
    _runId: string,
    _taskType: string,
    _inputs: TaskInput
  ): Promise<TaskOutput | undefined> {
    throw new Error(
      `${this.constructor.name}: getOutputForRun is not supported by this repository.`
    );
  }

  /**
   * Delete every entry for `runId`. Used by `RunPrivateCacheRepo.clearRun()`.
   * Indexed on the run-private schema's runId-leading primary key. Default throws.
   */
  async deleteRun(_runId: string): Promise<void> {
    throw new Error(`${this.constructor.name}: deleteRun is not supported by this repository.`);
  }

  /**
   * Delete entries for `runId` created more than `olderThanMs` ago. Used by
   * `RunPrivateCacheRepo.clearOlderThan()`. Default throws.
   */
  async deleteRunOlderThan(_runId: string, _olderThanMs: number): Promise<void> {
    throw new Error(
      `${this.constructor.name}: deleteRunOlderThan is not supported by this repository.`
    );
  }

  /**
   * Count entries for `runId`. Used by `RunPrivateCacheRepo.size()` so the
   * wrapper's count reflects only its own run. Default throws.
   */
  async sizeForRun(_runId: string): Promise<number> {
    throw new Error(`${this.constructor.name}: sizeForRun is not supported by this repository.`);
  }
}

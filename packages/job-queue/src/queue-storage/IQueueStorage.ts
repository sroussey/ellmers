/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";

export const QUEUE_STORAGE = createServiceToken<IQueueStorage<any, any>>("jobqueue.storage");

/**
 * The type of a prefix column.
 * - "uuid" maps to UUID in PostgreSQL/Supabase, TEXT in SQLite/IndexedDB/InMemory
 * - "number" maps to INTEGER in PostgreSQL/Supabase/SQLite, number in IndexedDB/InMemory
 */
export type PrefixColumnType = "uuid" | "number";

/**
 * Defines a prefix column for queue storage filtering.
 */
export interface PrefixColumn {
  readonly name: string;
  readonly type: PrefixColumnType;
}

/**
 * Options for configuring queue storage with prefix filters.
 */
export interface QueueStorageOptions {
  /** The prefix column definitions for this storage */
  readonly prefixes?: readonly PrefixColumn[];
  /** The values for each prefix column */
  readonly prefixValues?: Readonly<Record<string, string | number>>;
}

export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "ABORTING" | "FAILED" | "DISABLED";
export const JobStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  ABORTING: "ABORTING",
  FAILED: "FAILED",
  DISABLED: "DISABLED",
} as const satisfies Record<JobStatus, JobStatus>;

/**
 * Type of change that occurred in the queue.
 *
 * `RESYNC` is a synthetic event emitted by some backends (e.g. Postgres
 * LISTEN/NOTIFY) after a (re)connect to indicate that arbitrary changes may
 * have happened during a disconnect window. Subscribers should treat it as a
 * "kick the workers, re-poll state" signal — `old` and `new` are both
 * undefined.
 */
export type QueueChangeType = "INSERT" | "UPDATE" | "DELETE" | "RESYNC";

/**
 * Payload describing a change to a job
 */
export interface QueueChangePayload<Input, Output> {
  readonly type: QueueChangeType;
  readonly old?: JobStorageFormat<Input, Output>;
  readonly new?: JobStorageFormat<Input, Output>;
}

/**
 * Options for subscribing to queue changes
 */
export interface QueueSubscribeOptions {
  /** Polling interval in milliseconds (used by implementations that rely on polling) */
  readonly pollingIntervalMs?: number;
  /**
   * Custom prefix filter for this subscription.
   *
   * - If not provided (undefined): Uses the storage instance's configured prefixValues
   * - If empty object ({}): Receives ALL changes across all prefix combinations
   * - If partial object: Receives changes matching the specified subset of prefixes
   *
   * @example
   * // Storage configured with prefixes: [{name: "user_id"}, {name: "project_id"}]
   * // and prefixValues: {user_id: "abc", project_id: "123"}
   *
   * // Subscribe to only this user+project (default behavior)
   * storage.subscribeToChanges(callback);
   *
   * // Subscribe to all projects for this user
   * storage.subscribeToChanges(callback, { prefixFilter: { user_id: "abc" } });
   *
   * // Subscribe to ALL jobs in this queue (admin/supervisor view)
   * storage.subscribeToChanges(callback, { prefixFilter: {} });
   */
  readonly prefixFilter?: Readonly<Record<string, string | number>>;
}

/**
 * Details about a job that reflect the structure in the database.
 */
export type JobStorageFormat<Input, Output> = {
  id?: unknown;
  job_run_id?: string;
  queue?: string;
  input: Input;
  output?: Output | null;
  error?: string | null;
  error_code?: string | null;
  fingerprint?: string;
  max_retries?: number;
  status?: JobStatus;
  created_at?: string;
  deadline_at?: string | null;
  last_ran_at?: string | null;
  run_after: string | null;
  completed_at: string | null;
  run_attempts?: number;
  progress?: number;
  progress_message?: string;
  progress_details?: Record<string, any> | null;
  worker_id?: string | null;
};

/**
 * Whether a queue storage's state is shared across processes.
 *
 * - `"process"` — in-memory / per-process state. Workers in the same process
 *   share it, but separate processes do not.
 * - `"cluster"` — state lives in shared external storage (Postgres, Supabase,
 *   etc.) visible to every process. Pairing a `"process"`-scoped limiter with
 *   a `"cluster"`-scoped queue almost always indicates a misconfiguration.
 */
export type QueueStorageScope = "process" | "cluster";

/**
 * Interface defining the storage operations for a job queue
 */
export interface IQueueStorage<Input, Output> {
  /**
   * Whether this storage is shared across processes. In-memory / browser
   * backends MUST report `"process"`. Shared databases (Postgres, Supabase)
   * report `"cluster"`. Used by JobQueueServer to detect process-scoped
   * limiters paired with cluster-scoped queues.
   */
  readonly scope: QueueStorageScope;

  /**
   * Adds a job to the queue storage
   * @param job - The job to add to the queue storage
   * @returns The ID of the job
   */
  add(job: JobStorageFormat<Input, Output>): Promise<unknown>;

  /**
   * Gets a job from the queue storage by ID
   * @param id - The ID of the job to get
   * @returns The job with the given ID
   */
  get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined>;

  /**
   * Gets the next job from the queue storage
   * @param workerId - Worker ID to associate with the job (required)
   * @returns The next job from the queue storage
   */
  next(workerId: string): Promise<JobStorageFormat<Input, Output> | undefined>;

  /**
   * Releases a job that was just claimed by {@link next} but won't be
   * processed (e.g. the worker was stopped mid-claim). Resets status to
   * PENDING and clears worker_id WITHOUT incrementing run_attempts —
   * the worker never actually attempted execution, so the retry budget
   * must be preserved.
   * @param id - The id of the claimed job to release.
   */
  release(id: unknown): Promise<void>;

  /**
   * Peeks at the next job(s) from the queue storage without removing them
   * @param status - The status of the jobs to peek at
   * @param num - The number of jobs to peek at
   * @returns The jobs with the given status
   */
  peek(status?: JobStatus, num?: number): Promise<Array<JobStorageFormat<Input, Output>>>;

  /**
   * Gets the size of the queue storage
   * @param status - The status of the jobs to get the size for
   * @returns The size of the queue storage
   */
  size(status?: JobStatus): Promise<number>;

  /**
   * Completes a job in the queue storage
   * @param job - The job to complete
   */
  complete(job: JobStorageFormat<Input, Output>): Promise<void>;

  /**
   * Deletes all jobs from the queue storage
   */
  deleteAll(): Promise<void>;

  /**
   * Gets the output for a given input from the queue storage
   * @param input - The input to get the output for
   * @returns The output of the job
   */
  outputForInput(input: Input): Promise<Output | null>;

  /**
   * Aborts a job in the queue storage
   * @param id - The ID of the job to abort
   */
  abort(id: unknown): Promise<void>;

  /**
   * Gets the jobs by job run ID from the queue storage
   * @param runId - The job run ID of the jobs to get
   * @returns The jobs with the given job run ID
   */
  getByRunId(runId: string): Promise<Array<JobStorageFormat<Input, Output>>>;

  /**
   * Saves progress updates for a job in the queue storage
   * @param id - The ID of the job to save the progress for
   * @param progress - The progress of the job
   * @param message - The message of the job
   * @param details - The details of the job
   */
  saveProgress(
    id: unknown,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void>;

  /**
   * Deletes a job by its ID from the queue storage
   * @param id - The ID of the job to delete
   */
  delete(id: unknown): Promise<void>;

  /**
   * Deletes jobs from the queue storage that are of a specific status and older than the specified time
   * @param status - The status of the jobs to delete
   * @param olderThanMs - The time in milliseconds that the jobs must be older than to be deleted
   */
  deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void>;

  /**
   * Sets up the database schema and tables.
   *
   * @deprecated Production code should run versioned migrations instead — call
   * {@link migrate} (or run {@link getMigrations} through a `MigrationRunner`
   * from `@workglow/postgres` / `@workglow/sqlite`). This method is kept for
   * tests and ad-hoc scripts that previously relied on idempotent
   * CREATE-IF-NOT-EXISTS DDL.
   */
  setupDatabase(): Promise<void>;

  /**
   * Applies any pending migrations for this queue's tables.
   *
   * Optional because backends without a real schema (in-memory, IndexedDB)
   * have nothing to migrate. SQL backends (Postgres, SQLite, Supabase)
   * implement this and it is the recommended production entry point.
   */
  migrate?(): Promise<void>;

  /**
   * Returns this storage's versioned migrations as opaque, runnable units.
   *
   * Callers can pass them to `SqliteMigrationRunner` / `PostgresMigrationRunner`
   * to compose migrations across multiple storages into a single deployment
   * step. Optional for the same reason as {@link migrate}.
   */
  getMigrations?(): ReadonlyArray<unknown>;

  /**
   * Subscribes to changes in the queue (including remote changes).
   * @param callback - Function called when a change occurs
   * @param options - Optional subscription options (e.g., polling interval)
   * @returns Unsubscribe function
   */
  subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void;
}

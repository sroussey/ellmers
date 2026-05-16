/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IQueueStorage,
  JobStorageFormat,
  PrefixColumn,
  QueueChangePayload,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "@workglow/job-queue";
import { JobStatus } from "@workglow/job-queue";
import type { Sqlite } from "@workglow/sqlite/storage";
import {
  assertPrefixesSafe,
  buildPrefixInsertFragments,
  buildPrefixWhereClause,
  getPrefixParamValues,
  SqliteDialect,
} from "@workglow/storage";
import { createServiceToken, makeFingerprint, sleep, uuid4 } from "@workglow/util";
import { SqliteMigrationRunner } from "../migrations/SqliteMigrationRunner";
import { sqliteQueueMigrations } from "../migrations/sqliteQueueMigrations";

export const SQLITE_QUEUE_STORAGE =
  createServiceToken<IQueueStorage<any, any>>("jobqueue.storage.sqlite");

type JobRowWithJsonStrings<Input, Output> = JobStorageFormat<Input, Output> & {
  input: string;
  output: string | null;
  progress_details: string | null;
};

/**
 * Extended options for SQLite queue storage including prefix support
 */
export interface SqliteQueueStorageOptions extends QueueStorageOptions {
  readonly deleteAfterCompletionMs?: number;
  readonly deleteAfterFailureMs?: number;
}

/**
 * SQLite implementation of a job queue.
 * Provides storage and retrieval for job execution states using SQLite.
 */
export class SqliteQueueStorage<Input, Output> implements IQueueStorage<Input, Output> {
  /**
   * SQLite is in-process only at the application layer (no LISTEN/NOTIFY,
   * no shared client across processes). Even if the underlying file is
   * shared via NFS, the queue contract requires cross-process change
   * notification we don't provide here, so callers must treat it as
   * `"process"` scope.
   */
  public readonly scope = "process" as const;
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** The table name for the job queue */
  protected readonly tableName: string;

  constructor(
    protected db: Sqlite.Database,
    protected queueName: string,
    protected options?: SqliteQueueStorageOptions
  ) {
    this.prefixes = options?.prefixes ?? [];
    this.prefixValues = options?.prefixValues ?? {};
    // Validate prefix column names eagerly — they are spliced into DDL and
    // table names without parameterisation, so unsafe identifiers must fail
    // at construction rather than at the first migrate()/query call.
    assertPrefixesSafe(this.prefixes);
    // Generate table name based on prefix configuration to avoid column conflicts
    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.tableName = `job_queue_${prefixNames}`;
    } else {
      this.tableName = "job_queue";
    }
  }

  /** WHERE-clause helper for the SQLite dialect (positional `?` placeholders). */
  private buildPrefixWhereClause(): string {
    return buildPrefixWhereClause(SqliteDialect, this.prefixes, this.prefixValues).conditions;
  }

  /** Returns prefix values in column order. */
  private getPrefixParamValues(): Array<string | number> {
    return getPrefixParamValues(this.prefixes, this.prefixValues);
  }

  /**
   * Returns the versioned migrations that this storage's table layout depends
   * on. Callers can compose them with other storages' migrations under a
   * shared {@link SqliteMigrationRunner}; otherwise call {@link migrate}.
   */
  public getMigrations() {
    return sqliteQueueMigrations(this.tableName, this.prefixes);
  }

  /**
   * Applies any pending migrations for this queue's table. Idempotent —
   * already-applied versions are recorded in `_storage_migrations` and
   * skipped on subsequent calls.
   */
  public async migrate(): Promise<void> {
    await sleep(0);
    await new SqliteMigrationRunner(this.db).run(this.getMigrations());
  }

  /**
   * Adds a new job to the queue.
   * @param job - The job to add
   * @returns The ID of the added job
   */
  public async add(job: JobStorageFormat<Input, Output>): Promise<unknown> {
    const now = new Date().toISOString();
    job.job_run_id = job.job_run_id ?? uuid4();
    job.queue = this.queueName;
    job.fingerprint = await makeFingerprint(job.input);
    job.status = JobStatus.PENDING;
    job.progress = 0;
    job.progress_message = "";
    job.progress_details = null;
    job.created_at = now;
    job.visible_at = now;

    const { columns: prefixColumnsInsert, placeholders: prefixPlaceholders } =
      buildPrefixInsertFragments(SqliteDialect, this.prefixes);
    const prefixParamValues = this.getPrefixParamValues();

    const AddQuery = `
      INSERT INTO ${this.tableName}(
        ${prefixColumnsInsert}queue,
        fingerprint,
        input,
        visible_at,
        deadline_at,
        max_attempts,
        job_run_id,
        progress,
        progress_message,
        progress_details,
        created_at
      )
      VALUES (${prefixPlaceholders}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`;

    const stmt = this.db.prepare<unknown[], { id: string }>(AddQuery);

    const result = stmt.get(
      ...prefixParamValues,
      job.queue,
      job.fingerprint,
      JSON.stringify(job.input),
      job.visible_at,
      job.deadline_at ?? null,
      job.max_attempts!,
      job.job_run_id,
      job.progress,
      job.progress_message,
      job.progress_details ? JSON.stringify(job.progress_details) : null,
      job.created_at
    ) as { id: string } | undefined;

    job.id = result?.id;
    return result?.id;
  }

  /**
   * Retrieves a job by its ID.
   * @param id - The ID of the job to retrieve
   * @returns The job if found, undefined otherwise
   */
  public async get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const JobQuery = `
      SELECT *
        FROM ${this.tableName}
        WHERE id = ? AND queue = ?${prefixConditions}
        LIMIT 1`;
    const stmt = this.db.prepare<
      unknown[],
      JobStorageFormat<Input, Output> & {
        input: string;
        output: string | null;
        progress_details: string | null;
      }
    >(JobQuery);
    const result = stmt.get(String(id), this.queueName, ...prefixParams);
    if (!result) return undefined;

    // Parse JSON fields
    if (result.input) result.input = JSON.parse(result.input);
    if (result.output) result.output = JSON.parse(result.output);
    if (result.progress_details) result.progress_details = JSON.parse(result.progress_details);
    return result;
  }

  /**
   * Retrieves a slice of jobs from the queue.
   * @param num - Maximum number of jobs to return
   * @returns An array of jobs
   */
  public async peek(
    status: JobStatus = JobStatus.PENDING,
    num: number = 100
  ): Promise<Array<JobStorageFormat<Input, Output>>> {
    num = Math.max(1, Math.min(10000, Math.floor(Number(num) || 100))); // Validate and clamp to safe range
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const FutureJobQuery = `
      SELECT *
        FROM ${this.tableName}
        WHERE queue = ?
        AND status = ?${prefixConditions}
        ORDER BY visible_at ASC
        LIMIT ${num}`;
    const stmt = this.db.prepare<
      unknown[],
      JobStorageFormat<Input, Output> & {
        input: string;
        output: string | null;
        progress_details: string | null;
      }
    >(FutureJobQuery);
    const result = stmt.all(this.queueName, status, ...prefixParams);
    return (result || []).map((details: JobRowWithJsonStrings<Input, Output>) => {
      // Parse JSON fields
      if (details.input) details.input = JSON.parse(details.input);
      if (details.output) details.output = JSON.parse(details.output);
      if (details.progress_details) details.progress_details = JSON.parse(details.progress_details);

      return details;
    });
  }

  /**
   * Aborts a job.
   * - If PENDING: immediately mark as FAILED with abort_requested_at set.
   * - If PROCESSING: set abort_requested_at only (leave status as PROCESSING).
   * - Otherwise: no-op.
   */
  public async abort(jobId: unknown): Promise<void> {
    const now = new Date().toISOString();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    // Abort PENDING → FAILED immediately
    const AbortPendingQuery = `
      UPDATE ${this.tableName}
        SET status = ?, abort_requested_at = ?, completed_at = ?
        WHERE id = ? AND queue = ? AND status = ?${prefixConditions}`;
    const stmtPending = this.db.prepare(AbortPendingQuery);
    stmtPending.run(
      JobStatus.FAILED,
      now,
      now,
      String(jobId),
      this.queueName,
      JobStatus.PENDING,
      ...prefixParams
    );

    // Abort PROCESSING → set abort_requested_at only
    const AbortProcessingQuery = `
      UPDATE ${this.tableName}
        SET abort_requested_at = ?
        WHERE id = ? AND queue = ? AND status = ?${prefixConditions}`;
    const stmtProcessing = this.db.prepare(AbortProcessingQuery);
    stmtProcessing.run(now, String(jobId), this.queueName, JobStatus.PROCESSING, ...prefixParams);
  }

  /**
   * Releases a claimed job back to PENDING without incrementing attempts.
   * @param jobId - The id of the claimed job to release.
   */
  public async releaseClaim(jobId: unknown): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const ReleaseQuery = `
      UPDATE ${this.tableName}
        SET status = ?,
            lease_owner = NULL,
            progress = 0,
            progress_message = '',
            progress_details = NULL
        WHERE id = ? AND queue = ?${prefixConditions}`;
    const stmt = this.db.prepare(ReleaseQuery);
    stmt.run(JobStatus.PENDING, String(jobId), this.queueName, ...prefixParams);
  }

  /** Force-overwrite status without touching attempts (used to persist DISABLED after lease release). */
  public saveStatus(jobId: unknown, status: string): void {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();
    const stmt = this.db.prepare(
      `UPDATE ${this.tableName} SET status = ? WHERE id = ? AND queue = ?${prefixConditions}`
    );
    stmt.run(status, String(jobId), this.queueName, ...prefixParams);
  }

  /**
   * Retrieves all jobs for a given job run ID.
   * @param job_run_id - The ID of the job run to retrieve
   * @returns An array of jobs
   */
  public async getByRunId(job_run_id: string): Promise<Array<JobStorageFormat<Input, Output>>> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const JobsByRunIdQuery = `
      SELECT *
        FROM ${this.tableName}
        WHERE job_run_id = ? AND queue = ?${prefixConditions}`;
    const stmt = this.db.prepare<
      unknown[],
      JobStorageFormat<Input, Output> & {
        input: string;
        output: string | null;
        progress_details: string | null;
      }
    >(JobsByRunIdQuery);
    const result = stmt.all(job_run_id, this.queueName, ...prefixParams);
    return (result || []).map((details: JobRowWithJsonStrings<Input, Output>) => {
      // Parse JSON fields
      if (details.input) details.input = JSON.parse(details.input);
      if (details.output) details.output = JSON.parse(details.output);
      if (details.progress_details) details.progress_details = JSON.parse(details.progress_details);

      return details;
    });
  }

  /**
   * Retrieves the next available job that is ready to be processed.
   * Claims PENDING jobs ready to run, and also reclaims PROCESSING jobs whose
   * lease has expired (crash recovery). Sets lease_expires_at on the claimed row.
   *
   * @param workerId - Worker ID to associate with the job
   * @param opts - Optional options including leaseMs (default 30000)
   * @returns The next job or undefined if no job is available
   */
  public async next(
    workerId: string,
    opts?: { leaseMs?: number }
  ): Promise<JobStorageFormat<Input, Output> | undefined> {
    const now = new Date().toISOString();
    const leaseMs = opts?.leaseMs ?? 30000;
    const leaseExpiry = new Date(Date.now() + leaseMs).toISOString();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    // Claim either a PENDING job ready to run, or a PROCESSING job with an expired lease
    const stmt = this.db.prepare<
      unknown[],
      JobStorageFormat<Input, Output> & {
        input: string;
        output: string | null;
        progress_details: string | null;
      }
    >(
      `
      UPDATE ${this.tableName}
      SET status = ?, last_attempted_at = ?, lease_owner = ?, lease_expires_at = ?
      WHERE id = (
        SELECT id
        FROM ${this.tableName}
        WHERE queue = ?
        AND (
          (status = ? AND visible_at <= ?)
          OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?))
        )${prefixConditions}
        ORDER BY visible_at ASC
        LIMIT 1
      )
      RETURNING *`
    );
    const result = stmt.get(
      JobStatus.PROCESSING,
      now,
      workerId,
      leaseExpiry,
      this.queueName,
      JobStatus.PENDING,
      now,
      JobStatus.PROCESSING,
      now,
      ...prefixParams
    );
    if (!result) return undefined;

    // Parse JSON fields
    if (result.input) result.input = JSON.parse(result.input);
    if (result.output) result.output = JSON.parse(result.output);
    if (result.progress_details) result.progress_details = JSON.parse(result.progress_details);

    return result;
  }

  /**
   * Extend the lease on a currently PROCESSING job.
   * @param id - The ID of the job to extend the lease for
   * @param workerId - Worker ID that must match the current lease owner (lease_owner)
   * @param ms - Number of milliseconds to extend the lease by
   */
  public async extendLease(id: unknown, workerId: string, ms: number): Promise<void> {
    const leaseExpiry = new Date(Date.now() + ms).toISOString();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const stmt = this.db.prepare<unknown[], { changes: number }>(
      `UPDATE ${this.tableName}
         SET lease_expires_at = ?
         WHERE id = ? AND queue = ? AND lease_owner = ? AND status = ?${prefixConditions}`
    );
    const info = stmt.run(
      leaseExpiry,
      String(id),
      this.queueName,
      workerId,
      JobStatus.PROCESSING,
      ...prefixParams
    ) as { changes: number };
    if (info.changes === 0) {
      throw new Error(
        `extendLease failed: job ${String(id)} is not PROCESSING or lease is not owned by worker ${workerId}`
      );
    }
  }

  /**
   * Retrieves the number of jobs in the queue with a specific status.
   * @param status - The status of the jobs to count
   * @returns The count of jobs with the specified status
   */
  public async size(status = JobStatus.PENDING): Promise<number> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const sizeQuery = `
      SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE queue = ?
        AND status = ?${prefixConditions}`;
    const stmt = this.db.prepare<unknown[], { count: number }>(sizeQuery);
    const result = stmt.get(this.queueName, status, ...prefixParams) as any;
    return result.count;
  }

  /**
   * Marks a job as complete with its output or error.
   * Enhanced error handling:
   * - Increments the retry count.
   * - For a retryable error, updates visible_at with the retry date.
   * - Marks the job as FAILED for permanent or generic errors.
   * - Marks the job as DISABLED for disabled jobs.
   */
  public async complete(job: JobStorageFormat<Input, Output>): Promise<void> {
    const now = new Date().toISOString();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    let updateQuery: string;
    let params: Array<string | number | null>;
    if (job.status === JobStatus.DISABLED) {
      updateQuery = `
          UPDATE ${this.tableName} 
            SET 
              status = ?, 
              progress = 100, 
              progress_message = '', 
              progress_details = NULL, 
              completed_at = ?  
            WHERE id = ? AND queue = ?${prefixConditions}`;
      params = [job.status, now, job.id as string, this.queueName, ...prefixParams];
    } else {
      updateQuery = `
          UPDATE ${this.tableName}
            SET
              output = ?,
              error = ?,
              error_code = ?,
              status = ?,
              progress = 100,
              progress_message = '',
              progress_details = NULL,
              last_attempted_at = ?,
              completed_at = ?,
              attempts = attempts + 1
            WHERE id = ? AND queue = ?${prefixConditions}`;
      params = [
        job.output ? JSON.stringify(job.output) : null,
        job.error ?? null,
        job.error_code ?? null,
        job.status!,
        now,
        now,
        job.id as string,
        this.queueName,
        ...prefixParams,
      ];
    }
    const stmt = this.db.prepare(updateQuery);
    stmt.run(...params);
  }

  public async deleteAll(): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const ClearQuery = `
      DELETE FROM ${this.tableName}
        WHERE queue = ?${prefixConditions}`;
    const stmt = this.db.prepare(ClearQuery);
    stmt.run(this.queueName, ...prefixParams);
  }

  /**
   * Looks up cached output for a given input
   * Uses input fingerprinting for efficient matching
   * @returns The cached output or null if not found
   */
  public async outputForInput(input: Input): Promise<Output | null> {
    const fingerprint = await makeFingerprint(input);
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const OutputQuery = `
      SELECT output
        FROM ${this.tableName}
        WHERE queue = ? AND fingerprint = ? AND status = ?${prefixConditions}`;
    const stmt = this.db.prepare<unknown[], { output: string }>(OutputQuery);
    const result = stmt.get(this.queueName, fingerprint, JobStatus.COMPLETED, ...prefixParams);
    return result?.output ? JSON.parse(result.output) : null;
  }

  /**
   * Implements the abstract saveProgress method from JobQueue
   */
  public async saveProgress(
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, any>
  ): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const UpdateProgressQuery = `
      UPDATE ${this.tableName}
        SET progress = ?,
            progress_message = ?,
            progress_details = ?
        WHERE id = ? AND queue = ?${prefixConditions}`;

    const stmt = this.db.prepare(UpdateProgressQuery);
    stmt.run(
      progress,
      message,
      JSON.stringify(details),
      String(jobId),
      this.queueName,
      ...prefixParams
    );
  }

  /**
   * Deletes a job by its ID
   */
  public async delete(jobId: unknown): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const DeleteQuery = `
      DELETE FROM ${this.tableName}
        WHERE id = ? AND queue = ?${prefixConditions}`;
    const stmt = this.db.prepare(DeleteQuery);
    stmt.run(String(jobId), this.queueName, ...prefixParams);
  }

  /**
   * Delete jobs with a specific status older than a cutoff date
   * @param status - Status of jobs to delete
   * @param olderThanMs - Delete jobs completed more than this many milliseconds ago
   */
  public async deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const DeleteQuery = `
      DELETE FROM ${this.tableName}
        WHERE queue = ?
        AND status = ?
        AND completed_at IS NOT NULL
        AND completed_at <= ?${prefixConditions}`;
    const stmt = this.db.prepare(DeleteQuery);
    stmt.run(this.queueName, status, cutoffDate, ...prefixParams);
  }

  /**
   * Subscribes to changes in the queue.
   * NOT IMPLEMENTED for SQLite storage.
   *
   * @throws Error always - subscribeToChanges is not supported for SQLite storage
   */
  public subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    throw new Error("subscribeToChanges is not supported for SqliteQueueStorage");
  }
}

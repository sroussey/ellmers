/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sqlite } from "@workglow/sqlite/storage";
import { createServiceToken, makeFingerprint, sleep, uuid4 } from "@workglow/util";
import { JobStatus } from "@workglow/job-queue";
import type {
  IQueueStorage,
  JobStorageFormat,
  PrefixColumn,
  QueueChangePayload,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "@workglow/job-queue";
import {
  assertPrefixesSafe,
  buildPrefixInsertFragments,
  buildPrefixWhereClause,
  getPrefixParamValues,
  SqliteDialect,
} from "@workglow/storage";
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
   * Returns the versioned migrations that this storage's table layout depends on.
   * Production code should run these via {@link SqliteMigrationRunner} as part
   * of an explicit migration step rather than calling {@link setupDatabase}.
   */
  public getMigrations() {
    return sqliteQueueMigrations(this.tableName, this.prefixes);
  }

  /**
   * Applies any pending migrations for this queue's table.
   * Safe to call repeatedly — already-applied versions are skipped.
   */
  public async migrate(): Promise<void> {
    await new SqliteMigrationRunner(this.db).run(this.getMigrations());
  }

  /**
   * @deprecated Use {@link migrate} (or run {@link getMigrations} via your own
   * {@link SqliteMigrationRunner}) in production. Kept for tests and ad-hoc
   * scripts that previously relied on idempotent CREATE-IF-NOT-EXISTS DDL.
   */
  public async setupDatabase(): Promise<void> {
    await sleep(0);
    await this.migrate();
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
    job.run_after = now;

    const { columns: prefixColumnsInsert, placeholders: prefixPlaceholders } =
      buildPrefixInsertFragments(SqliteDialect, this.prefixes);
    const prefixParamValues = this.getPrefixParamValues();

    const AddQuery = `
      INSERT INTO ${this.tableName}(
        ${prefixColumnsInsert}queue, 
        fingerprint, 
        input, 
        run_after, 
        deadline_at, 
        max_retries, 
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
      job.run_after,
      job.deadline_at ?? null,
      job.max_retries!,
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
        ORDER BY run_after ASC
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
   * Aborts a job by setting its status to "ABORTING".
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  public async abort(jobId: unknown): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const AbortQuery = `
      UPDATE ${this.tableName}
        SET status = ?  
        WHERE id = ? AND queue = ?${prefixConditions}`;
    const stmt = this.db.prepare(AbortQuery);
    stmt.run(JobStatus.ABORTING, String(jobId), this.queueName, ...prefixParams);
  }

  /**
   * Releases a claimed job back to PENDING without incrementing run_attempts.
   * @param jobId - The id of the claimed job to release.
   */
  public async release(jobId: unknown): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const ReleaseQuery = `
      UPDATE ${this.tableName}
        SET status = ?,
            worker_id = NULL,
            progress = 0,
            progress_message = '',
            progress_details = NULL
        WHERE id = ? AND queue = ?${prefixConditions}`;
    const stmt = this.db.prepare(ReleaseQuery);
    stmt.run(JobStatus.PENDING, String(jobId), this.queueName, ...prefixParams);
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
   * Retrieves the next available job that is ready to be processed,
   * and updates its status to PROCESSING.
   *
   * @param workerId - Worker ID to associate with the job
   * @returns The next job or undefined if no job is available
   */
  public async next(workerId: string): Promise<JobStorageFormat<Input, Output> | undefined> {
    const now = new Date().toISOString();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    // Then, get the next job to process
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
      SET status = ?, last_ran_at = ?, worker_id = ?
      WHERE id = (
        SELECT id 
        FROM ${this.tableName} 
        WHERE queue = ? 
        AND status = ?${prefixConditions}
        AND run_after <= ? 
        ORDER BY run_after ASC 
        LIMIT 1
      )
      RETURNING *`
    );
    const result = stmt.get(
      JobStatus.PROCESSING,
      now,
      workerId,
      this.queueName,
      JobStatus.PENDING,
      ...prefixParams,
      now
    );
    if (!result) return undefined;

    // Parse JSON fields
    if (result.input) result.input = JSON.parse(result.input);
    if (result.output) result.output = JSON.parse(result.output);
    if (result.progress_details) result.progress_details = JSON.parse(result.progress_details);

    return result;
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
   * - For a retryable error, updates run_after with the retry date.
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
              last_ran_at = ?,
              completed_at = ?,
              run_attempts = run_attempts + 1
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

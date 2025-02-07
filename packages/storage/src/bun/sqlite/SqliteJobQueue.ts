//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ILimiter,
  JobQueue,
  Job,
  JobStatus,
  RetryableJobError,
  JobError,
  PermanentJobError,
} from "ellmers-core";
import { makeFingerprint, toSQLiteTimestamp } from "../../util/Misc";
import { type Database } from "bun:sqlite";
import { nanoid } from "nanoid";

// TODO: reuse prepared statements

/**
 * SQLite implementation of a job queue.
 * Provides storage and retrieval for job execution states using SQLite.
 */
export class SqliteJobQueue<Input, Output> extends JobQueue<Input, Output> {
  constructor(
    protected db: Database,
    queue: string,
    limiter: ILimiter,
    jobClass: typeof Job<Input, Output> = Job<Input, Output>,
    waitDurationInMilliseconds = 100
  ) {
    super(queue, limiter, jobClass, waitDurationInMilliseconds);
  }

  public ensureTableExists() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id INTEGER PRIMARY KEY,
        fingerprint text NOT NULL,
        queue text NOT NULL,
        jobRunId text NOT NULL,
        status TEXT NOT NULL default 'NEW',
        input TEXT NOT NULL,
        output TEXT,
        retries INTEGER default 0,
        maxRetries INTEGER default 23,
        runAfter TEXT DEFAULT CURRENT_TIMESTAMP,
        lastRanAt TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        deadlineAt TEXT,
        error TEXT,
        errorCode TEXT,
        progress REAL DEFAULT 0,
        progressMessage TEXT DEFAULT '',
        progressDetails TEXT NULL
      );
      
      CREATE INDEX IF NOT EXISTS job_queue_fetcher_idx ON job_queue (queue, status, runAfter);
      CREATE INDEX IF NOT EXISTS job_queue_fingerprint_idx ON job_queue (queue, fingerprint, status);
      CREATE INDEX IF NOT EXISTS job_queue_jobRunId_idx ON job_queue (queue, jobRunId);
    `);
    return this;
  }

  /**
   * Adds a new job to the queue.
   * @param job - The job to add
   * @returns The ID of the added job
   */
  public async add(job: Job<Input, Output>) {
    job.queueName = this.queue;
    const fingerprint = await makeFingerprint(job.input);
    job.fingerprint = fingerprint;
    job.jobRunId = job.jobRunId ?? nanoid();
    job.status = JobStatus.PENDING;
    job.progress = 0;
    job.progressMessage = "";
    job.progressDetails = null;

    const AddQuery = `
      INSERT INTO job_queue(queue, fingerprint, input, runAfter, deadlineAt, maxRetries, jobRunId, progress, progressMessage, progressDetails)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`;

    const stmt = this.db.prepare<
      { id: string },
      [
        queue: string,
        fingerprint: string,
        input: string,
        runAfter: string | null,
        deadlineAt: string | null,
        maxRetries: number,
        jobRunId: string,
        progress: number,
        progressMessage: string,
        progressDetails: string | null,
      ]
    >(AddQuery);

    const result = stmt.get(
      this.queue,
      fingerprint,
      JSON.stringify(job.input),
      toSQLiteTimestamp(job.runAfter),
      toSQLiteTimestamp(job.deadlineAt),
      job.maxRetries,
      job.jobRunId,
      job.progress,
      job.progressMessage,
      job.progressDetails ? JSON.stringify(job.progressDetails) : null
    ) as { id: string } | undefined;

    job.id = result?.id;
    this.createAbortController(job.id);
    return result?.id;
  }

  /**
   * Retrieves a job by its ID.
   * @param id - The ID of the job to retrieve
   * @returns The job if found, undefined otherwise
   */
  public async get(id: string) {
    const JobQuery = `
      SELECT *
        FROM job_queue
        WHERE id = $1 AND queue = $2
        LIMIT 1`;
    const stmt = this.db.prepare<Job<Input, Output>, [id: string, queue: string]>(JobQuery);
    const result = stmt.get(id, this.queue) as any;
    return result ? this.createNewJob(result) : undefined;
  }

  /**
   * Retrieves a slice of jobs from the queue.
   * @param num - Maximum number of jobs to return
   * @returns An array of jobs
   */
  public async peek(num: number = 100) {
    num = Number(num) || 100; // TS does not validate, so ensure it is a number since we put directly in SQL string
    const FutureJobQuery = `
      SELECT *
        FROM job_queue
        WHERE queue = $1
        AND status = $2
        AND runAfter > CURRENT_TIMESTAMP
        ORDER BY runAfter ASC
        LIMIT ${num}`;
    const stmt = this.db.prepare(FutureJobQuery);
    const ret: Array<Job<Input, Output>> = [];
    const result = stmt.all(this.queue, JobStatus.PENDING) as any[];
    for (const job of result || []) ret.push(this.createNewJob(job));
    return ret;
  }

  /**
   * Retrieves all jobs currently being processed.
   * @returns An array of jobs
   */
  public async processing() {
    const ProcessingQuery = `
      SELECT *
        FROM job_queue
        WHERE queue = $1
        AND status = $2`;
    const stmt = this.db.prepare(ProcessingQuery);
    const result = stmt.all(this.queue, JobStatus.PROCESSING) as any[];
    const ret: Array<Job<Input, Output>> = [];
    for (const job of result || []) ret.push(this.createNewJob(job));
    return ret;
  }

  /**
   * Retrieves all jobs currently being processed.
   * @returns An array of jobs
   */
  public async aborting() {
    const AbortingQuery = `
      SELECT *
        FROM job_queue
        WHERE queue = $1
        AND status = $2`;
    const stmt = this.db.prepare(AbortingQuery);
    const result = stmt.all(this.queue, JobStatus.ABORTING) as any[];
    const ret: Array<Job<Input, Output>> = [];
    for (const job of result || []) ret.push(this.createNewJob(job));
    return ret;
  }

  /**
   * Aborts a job by setting its status to "ABORTING".
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  public async abort(jobId: string) {
    const AbortQuery = `
      UPDATE job_queue
        SET status = $1
        WHERE id = $2 AND queue = $3`;
    const stmt = this.db.prepare(AbortQuery);
    stmt.run(JobStatus.ABORTING, jobId, this.queue);
    this.abortJob(jobId);
  }

  /**
   * Retrieves all jobs for a given job run ID.
   * @param jobRunId - The ID of the job run to retrieve
   * @returns An array of jobs
   */
  public async getJobsByRunId(jobRunId: string) {
    const JobsByRunIdQuery = `
      SELECT *
        FROM job_queue
        WHERE jobRunId = $1 AND queue = $2`;
    const stmt = this.db.prepare(JobsByRunIdQuery);
    const result = stmt.all(jobRunId, this.queue) as any[];
    const ret: Array<Job<Input, Output>> = [];
    for (const job of result || []) ret.push(this.createNewJob(job));
    return ret;
  }

  /**
   * Retrieves the next available job that is ready to be processed,
   * and updates its status to PROCESSING.
   *
   * @returns The next job or undefined if no job is available
   */
  public async next() {
    let id: string | undefined;
    {
      const PendingJobIDQuery = `
      SELECT id
        FROM job_queue
        WHERE queue = $1
        AND status = $2
        AND runAfter <= CURRENT_TIMESTAMP
        LIMIT 1`;
      const stmt = this.db.prepare(PendingJobIDQuery);
      const result = stmt.get(this.queue, JobStatus.PENDING) as any;
      if (!result) return undefined;
      id = result.id;
    }
    if (id) {
      const UpdateQuery = `
      UPDATE job_queue 
        SET status = ?
        WHERE id = ? AND queue = ?
        RETURNING *`;
      const stmt = this.db.prepare(UpdateQuery);
      const result = stmt.get(JobStatus.PROCESSING, id, this.queue) as Job<Input, Output>;
      const job = this.createNewJob(result);
      return job;
    }
  }

  /**
   * Retrieves the number of jobs in the queue with a specific status.
   * @param status - The status of the jobs to count
   * @returns The count of jobs with the specified status
   */
  public async size(status = JobStatus.PENDING) {
    const sizeQuery = `
      SELECT COUNT(*) as count
        FROM job_queue
        WHERE queue = $1
        AND status = $2`;
    const stmt = this.db.prepare<{ count: number }, [queue: string, status: string]>(sizeQuery);
    const result = stmt.get(this.queue, status) as any;
    return result.count;
  }

  /**
   * Marks a job as complete with its output or error.
   * Enhanced error handling:
   * - Increments the retry count.
   * - For a retryable error, updates runAfter with the retry date.
   * - Marks the job as FAILED for permanent or generic errors.
   */
  public async complete(id: string, output: Output | null = null, error?: JobError) {
    const job = await this.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    job.progress = 100;
    job.progressMessage = "";
    job.progressDetails = null;

    if (error) {
      job.error = error.message;
      job.errorCode = error.name;
      job.retries = (job.retries || 0) + 1;
      if (error instanceof RetryableJobError) {
        if (job.retries >= job.maxRetries) {
          job.status = JobStatus.FAILED;
          job.completedAt = new Date();
        } else {
          job.status = JobStatus.PENDING;
          job.runAfter = error.retryDate;
          job.progress = 0;
        }
      } else if (error instanceof PermanentJobError) {
        job.status = JobStatus.FAILED;
        job.completedAt = new Date();
      } else {
        job.status = JobStatus.FAILED;
        job.completedAt = new Date();
      }
    } else {
      job.status = JobStatus.COMPLETED;
      job.output = output;
      job.error = null;
      job.errorCode = null;
      job.completedAt = new Date();
    }

    let updateQuery: string;
    let params: any[];
    if (error && job.status === JobStatus.PENDING) {
      updateQuery = `
          UPDATE job_queue 
            SET 
              error = ?, 
              errorCode = ?, 
              status = ?, 
              progress = ?, 
              runAfter = ?, 
              progressMessage = "", 
              progressDetails = NULL, 
              lastRanAt = CURRENT_TIMESTAMP, 
              retries = retries + 1 
            WHERE id = ? AND queue = ?`;
      params = [
        error.message,
        error.name,
        job.status,
        job.progress,
        job.runAfter.toISOString(),
        id,
        this.queue,
      ];
    } else {
      updateQuery = `
          UPDATE job_queue 
            SET 
              output = ?, 
              error = ?, 
              errorCode = ?, 
              status = ?, 
              progress = ?, 
              retries = retries + 1, 
              progressMessage = "", 
              progressDetails = NULL, 
              lastRanAt = CURRENT_TIMESTAMP
            WHERE id = ? AND queue = ?`;
      params = [
        JSON.stringify(output),
        job.error ?? null,
        job.errorCode ?? null,
        job.status,
        job.progress,
        id,
        this.queue,
      ];
    }
    this.db.exec(updateQuery, params);
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      this.onCompleted(job.id, job.status, output, error);
    }
  }

  public async deleteAll() {
    const ClearQuery = `
      DELETE FROM job_queue
        WHERE queue = ?`;
    const stmt = this.db.prepare(ClearQuery);
    stmt.run(this.queue);
    await this.limiter.clear();
  }

  /**
   * Looks up cached output for a  input
   * Uses input fingerprinting for efficient matching
   * @returns The cached output or null if not found
   */
  public async outputForInput(input: Input) {
    const fingerprint = await makeFingerprint(input);
    const OutputQuery = `
      SELECT output
        FROM job_queue
        WHERE queue = ? AND fingerprint = ? AND status = ?`;
    const stmt = this.db.prepare(OutputQuery);
    const result = stmt.get(this.queue, fingerprint, JobStatus.COMPLETED) as
      | {
          output: string;
        }
      | undefined;
    return result?.output ? JSON.parse(result.output) : null;
  }

  /**
   * Implements the abstract saveProgress method from JobQueue
   */
  protected async saveProgress(
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, any>
  ): Promise<void> {
    const UpdateProgressQuery = `
      UPDATE job_queue
        SET progress = ?,
            progressMessage = ?,
            progressDetails = ?
        WHERE id = ? AND queue = ?`;

    const stmt = this.db.prepare(UpdateProgressQuery);
    stmt.run(progress, message, JSON.stringify(details), String(jobId), this.queue);
  }
}

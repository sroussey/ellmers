//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Sql } from "postgres";
import {
  Job,
  JobStatus,
  JobQueue,
  ILimiter,
  RetryableJobError,
  JobError,
  PermanentJobError,
} from "ellmers-core";
import { makeFingerprint } from "../../util/Misc";
import { nanoid } from "nanoid";

// TODO: prepared statements

/**
 * PostgreSQL implementation of a job queue.
 * Provides storage and retrieval for job execution states using PostgreSQL.
 */
export class PostgresJobQueue<Input, Output> extends JobQueue<Input, Output> {
  constructor(
    protected readonly sql: Sql,
    queue: string,
    limiter: ILimiter,
    jobClass: typeof Job<Input, Output> = Job<Input, Output>,
    waitDurationInMilliseconds = 100
  ) {
    super(queue, limiter, jobClass, waitDurationInMilliseconds);
  }

  public ensureTableExists() {
    this.sql`
    CREATE TABLE IF NOT EXISTS job_queue (
      id bigint SERIAL NOT NULL,
      fingerprint text NOT NULL,
      queue text NOT NULL,
      jobRunId text NOT NULL,
      status job_status NOT NULL default 'NEW',
      input jsonb NOT NULL,
      output jsonb,
      retries integer default 0,
      maxRetries integer default 23,
      runAfter timestamp with time zone DEFAULT now(),
      lastRanAt timestamp with time zone,
      createdAt timestamp with time zone DEFAULT now(),
      deadlineAt timestamp with time zone,
      error text,
      errorCode text,
      progress real DEFAULT 0,
      progressMessage text DEFAULT '',
      progressDetails jsonb
    );
    
    CREATE INDEX IF NOT EXISTS job_fetcher_idx ON job_queue (id, status, runAfter);
    CREATE INDEX IF NOT EXISTS job_queue_fetcher_idx ON job_queue (queue, status, runAfter);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_fingerprint_unique_idx ON job_queue (queue, fingerprint, status) WHERE NOT (status = 'COMPLETED');
    `;
    return this;
  }

  /**
   * Adds a new job to the queue.
   * @param job - The job to add
   * @returns The ID of the added job
   */
  public async add(job: Job<Input, Output>) {
    job.queueName = this.queue;
    job.jobRunId = job.jobRunId ?? nanoid();
    const fingerprint = await makeFingerprint(job.input);
    job.progress = 0;
    job.progressMessage = "";
    job.progressDetails = null;
    job.queue = this;

    return await this.sql.begin(async (sql) => {
      const jobid = await sql`
        INSERT INTO job_queue(
          queue, 
          fingerprint, 
          input, 
          runAfter, 
          maxRetries, 
          jobRunId, 
          progress, 
          progressMessage, 
          progressDetails
        )
        VALUES (
          ${this.queue!}, 
          ${fingerprint}, 
          ${job.input as any}::jsonb, 
          ${job.createdAt.toISOString()}, 
          ${job.maxRetries}, 
          ${job.jobRunId!},
          ${job.progress},
          ${job.progressMessage},
          ${job.progressDetails as any}::jsonb
        )
        RETURNING id`;
      this.createAbortController(jobid);
      job.id = jobid;
      return jobid;
    });
  }

  /**
   * Retrieves a job by its ID.
   * @param id - The ID of the job to retrieve
   * @returns The job if found, undefined otherwise
   */
  public async get(id: number) {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
        SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error, jobRunId
          FROM job_queue
          WHERE id = ${id}
          FOR UPDATE SKIP LOCKED
          LIMIT 1`;
      return this.createNewJob(result[0].rows[0]);
    });
  }

  /**
   * Retrieves a slice of jobs from the queue.
   * @param num - Maximum number of jobs to return
   * @returns An array of jobs
   */
  public async peek(num: number = 100) {
    num = Number(num) || 100; // TS does not validate, so ensure it is a number
    return await this.sql.begin(async (sql) => {
      const result = await sql`
      SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error, jobRunId
        FROM job_queue
        WHERE queue = ${this.queue}
        AND status = 'NEW'
        AND runAfter > NOW()
        ORDER BY runAfter ASC
        LIMIT ${num}
        FOR UPDATE SKIP LOCKED`;
      if (!result) return [];
      const ret = result[0].rows.map((r: any) => this.createNewJob(r));
      return ret;
    });
  }

  /**
   * Retrieves all jobs currently being processed.
   * @returns An array of jobs
   */
  public async processing() {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
      SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error, jobRunId
        FROM job_queue
        WHERE queue = ${this.queue}
        AND status = 'PROCESSING'`;
      if (!result) return [];
      const ret = result[0].rows.map((r: any) => this.createNewJob(r));
      return ret;
    });
  }

  /**
   * Retrieves all jobs currently being aborted.
   * @returns An array of jobs
   */
  public async aborting() {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
      SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error, jobRunId  
        FROM job_queue
        WHERE queue = ${this.queue}
        AND status = 'ABORTING'`;
      if (!result) return [];
      const ret = result[0].rows.map((r: any) => this.createNewJob(r));
      return ret;
    });
  }

  /**
   * Retrieves the next available job that is ready to be processed.
   * @returns The next job or undefined if no job is available
   */
  public async next() {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
        SELECT id
          FROM job_queue
          WHERE queue = ${this.queue}
          AND status = ${JobStatus.PENDING}
          AND runAfter <= NOW()
          FOR UPDATE SKIP LOCKED
          LIMIT 1`;
      if (!result) return undefined;
      const id = result[0].rows[0].id;
      const jobresult = await sql`
        UPDATE job_queue 
          SET status = ${JobStatus.PROCESSING}
          WHERE id = ${id} AND queue = ${this.queue}
          RETURNING *`;
      const job = this.createNewJob(jobresult[0].rows[0]);
      job.status = JobStatus.PROCESSING;
      return job;
    });
  }

  /**
   * Retrieves the number of jobs in the queue with a specific status.
   * @param status - The status of the jobs to count
   * @returns The count of jobs with the specified status
   */
  public async size(status = JobStatus.PENDING) {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
      SELECT COUNT(*) as count
        FROM job_queue
        WHERE queue = ${this.queue}
        AND status = ${status}
        AND runAfter <= NOW()`;
      return result[0].rows[0].count;
    });
  }

  /**
   * Marks a job as complete with its output or error.
   * Enhanced error handling:
   * - For a retryable error, increments retries and updates runAfter.
   * - Marks a job as FAILED immediately for permanent or generic errors.
   */
  public async complete(id: number, output: Output | null = null, error?: JobError): Promise<void> {
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

    await this.sql.begin(async (sql) => {
      if (error && job.status === JobStatus.PENDING) {
        await sql`
          UPDATE job_queue 
          SET output = ${output as any}::jsonb, 
              error = ${job.error}, 
              errorCode = ${job.errorCode},
              status = ${job.status}, 
              retries = retries + 1, 
              runAfter = ${job.runAfter.toISOString()}, 
              lastRanAt = NOW(),
              progress = ${job.progress},
              progressMessage = '',
              progressDetails = NULL
          WHERE id = ${id}`;
      } else {
        await sql`
          UPDATE job_queue 
          SET output = ${output as any}::jsonb, 
              error = ${job.error}, 
              errorCode = ${job.errorCode},
              status = ${job.status}, 
              retries = retries + 1, 
              lastRanAt = NOW(),
              progress = ${job.progress},
              progressMessage = '',
              progressDetails = NULL
          WHERE id = ${id}`;
      }
    });

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      this.onCompleted(id, job.status, output, error);
    }
  }

  /**
   * Clears all jobs from the queue.
   */
  public async deleteAll() {
    return await this.sql.begin(async (sql) => {
      await sql`
      DELETE FROM job_queue
        WHERE queue = ${this.queue}`;
    });
  }

  /**
   * Looks up cached output for a given input
   * Uses input fingerprinting for efficient matching
   * @returns The cached output or null if not found
   */
  public async outputForInput(input: Input) {
    const fingerprint = await makeFingerprint(input);
    return await this.sql.begin(async (sql) => {
      const result = await sql`
      SELECT output
        FROM job_queue
        WHERE fingerprint = ${fingerprint} AND queue=${this.queue} AND status = 'COMPLETED'`;
      return result[0].rows[0].output;
    });
  }

  /**
   * Aborts a job by setting its status to "ABORTING".
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  public async abort(jobId: number) {
    await this.sql.begin(async (sql) => {
      await sql`UPDATE job_queue SET status = 'ABORTING' WHERE id = ${jobId} AND queue = ${this.queue}`;
    });
    this.abortJob(jobId);
  }

  /**
   * Retrieves all jobs for a given job run ID.
   * @param jobRunId - The ID of the job run to retrieve
   * @returns An array of jobs
   */
  public async getJobsByRunId(jobRunId: string) {
    return await this.sql.begin(async (sql) => {
      const result =
        await sql`SELECT * FROM job_queue WHERE jobRunId = ${jobRunId} AND queue = ${this.queue}`;
      return result[0].rows.map((r: any) => this.createNewJob(r));
    });
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
    await this.sql.begin(async (sql) => {
      await sql`
        UPDATE job_queue 
        SET progress = ${progress},
            progressMessage = ${message},
            progressDetails = ${details as any}::jsonb
        WHERE id = ${jobId as number} AND queue = ${this.queue}`;
    });
  }
}

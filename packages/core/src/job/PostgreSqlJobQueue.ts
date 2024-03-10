//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { makeFingerprint } from "../util/Misc";
import { TaskInput, TaskOutput } from "../task/base/Task";
import { Sql } from "postgres";
import { Job, JobConstructorDetails, JobStatus } from "./Job";
import { JobQueue } from "./JobQueue";
import { ILimiter } from "./ILimiter";

// TODO: prepared statements

export class PostgreSqlJob extends Job {
  constructor(details: JobConstructorDetails) {
    super(details);
  }
}

export abstract class PostgreSqlJobQueue extends JobQueue {
  constructor(
    protected readonly sql: Sql,
    queue: string,
    limiter: ILimiter,
    protected jobClass: typeof PostgreSqlJob = PostgreSqlJob,
    waitDurationInMilliseconds = 100
  ) {
    super(queue, limiter, waitDurationInMilliseconds);
    this.ensureTableExists();
  }

  private ensureTableExists() {
    this.sql`

    CREATE TABLE IF NOT EXISTS job_queue (
      id bigint SERIAL NOT NULL,
      fingerprint text NOT NULL,
      queue text NOT NULL,
      status job_status NOT NULL default 'NEW',
      input jsonb,
      output jsonb,
      retries integer default 0,
      maxRetries integer default 23,
      runAfter timestamp with time zone DEFAULT now(),
      lastRanAt timestamp with time zone,
      createdAt timestamp with time zone DEFAULT now(),
      error text
    );
    
    CREATE INDEX IF NOT EXISTS job_fetcher_idx ON job_queue (id, status, runAfter);
    CREATE INDEX IF NOT EXISTS job_queue_fetcher_idx ON job_queue (queue, status, runAfter);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_fingerprint_unique_idx ON job_queue (queue, fingerprint, status) WHERE NOT (status = 'COMPLETED');
    
    `;
  }

  public async add(job: PostgreSqlJob) {
    const fingerprint = await makeFingerprint(job.input);
    return await this.sql.begin(async (sql) => {
      return await sql`
        INSERT INTO job_queue(queue, fingerprint, input, runAfter, maxRetries)
          VALUES (${job.queue}, ${fingerprint}, ${job.input as any}::jsonb, ${job.createdAt.toISOString()}, ${job.maxRetries})
          RETURNING id`;
    });
  }

  public async get(id: number) {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
        SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error
          FROM job_queue
          WHERE id = ${id}
          FOR UPDATE SKIP LOCKED
          LIMIT 1`;
      return new this.jobClass(result[0].rows[0]);
    });
  }

  public async peek(num: number = 100) {
    num = Number(num) || 100; // TS does not validate, so ensure it is a number
    return await this.sql.begin(async (sql) => {
      const result = await this.sql`
      SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error
        FROM job_queue
        WHERE queue = ${this.queue}
        AND status = 'NEW'
        AND runAfter > NOW()
        ORDER BY runAfter ASC
        LIMIT ${num}
        FOR UPDATE SKIP LOCKED`;
      if (!result) return [];
      const ret = result[0].rows.map((r: any) => new this.jobClass(r));
      return ret;
    });
  }

  public async next() {
    return await this.sql.begin(async (sql) => {
      const result = await sql`
        SELECT id
          FROM job_queue
          WHERE queue = ${this.queue}
          AND status = 'NEW'
          AND runAfter <= NOW()
          FOR UPDATE SKIP LOCKED
          LIMIT 1`;
      if (!result) return undefined;
      const id = result[0].rows[0].id;
      const jobresult = await sql`
        UPDATE job_queue 
          SET status = 'PROCESSING'
          WHERE id = ${id} AND queue = ${this.queue}
          RETURNING *`;
      const job = new this.jobClass(jobresult[0].rows[0]);
      job.status = JobStatus.PROCESSING;
      return job;
    });
  }

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

  public async complete(id: number, output: TaskOutput | null = null, error: string | null = null) {
    const job = await this.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    const status = output
      ? JobStatus.COMPLETED
      : error && job.retries >= job.maxRetries
        ? JobStatus.FAILED
        : JobStatus.PENDING;
    if (!output || error) job.retries += 1;
    return await this.sql.begin(async (sql) => {
      const result = await sql`    
        UPDATE job_queue 
          SET output = ${output as any}::jsonb, error = ${error}, status = ${status}, retries = retires + 1, lastRanAt = NOW()  
          WHERE id = ${id}`;
      return result[0].rows[0];
    });
  }

  public async clear() {
    return await this.sql.begin(async (sql) => {
      await sql`
      DELETE FROM job_queue
        WHERE queue = ${this.queue}`;
    });
  }

  public async outputForInput(taskType: string, input: TaskInput) {
    const fingerprint = await makeFingerprint(input);
    return await this.sql.begin(async (sql) => {
      const result = await sql`
      SELECT output
        FROM job_queue
        WHERE taskType = ${taskType} AND fingerprint = ${fingerprint} AND queue=${this.queue} AND status = 'COMPLETED'`;
      return result[0].rows[0].output;
    });
  }
}

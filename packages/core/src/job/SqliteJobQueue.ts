//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import uuid from "uuid";
import { TaskInput, TaskOutput } from "../task/Task";
import { getDatabase } from "../util/db_sqlite";
import { ILimiter } from "./ILimiter";
import { JobQueue } from "./JobQueue";
import { Job, JobConstructorDetails, JobStatus } from "./Job";
import { makeFingerprint } from "../util/Misc";

const db = getDatabase();

// ===============================================================================
//                             Local Sqlite Version
// ===============================================================================

// TODO: reuse prepared statements

export class SqliteJob extends Job {
  constructor(details: JobConstructorDetails) {
    if (!details.id) details.id = uuid.v4();
    super(details);
  }
}

export abstract class SqliteJobQueue extends JobQueue {
  constructor(queue: string, limiter: ILimiter) {
    super(queue, limiter);
    this.ensureTableExists();
  }

  private ensureTableExists() {
    db.exec(`

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
    
    CREATE INDEX IF NOT EXISTS job_fetcher_idx ON job_queue (id, queue);
    CREATE INDEX IF NOT EXISTS job_queue_fetcher_idx ON job_queue (queue, status, runAfter);
    CREATE INDEX IF NOT EXISTS job_queue_fingerprint_idx ON job_queue (queue, fingerprint, status);
    `);
  }

  public async add(job: SqliteJob) {
    const AddQuery = `
      INSERT INTO job_queue(queue, fingerprint, input, runAfter, deadlineAt, maxRetries)
		    VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`;
    const stmt = db.prepare(AddQuery);
    const result = stmt.run(
      job.queue,
      job.fingerprint,
      job.input,
      job.createdAt.toISOString(),
      job.maxRetries
    );
    return result.lastInsertRowid;
  }

  public async get(id: unknown) {
    const JobQuery = `
      SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error
        FROM job_queue
        WHERE id = $1 AND queue = $2
        LIMIT 1`;
    const stmt = db.prepare<[id: unknown, queue: string]>(JobQuery);
    const result = stmt.get(id, this.queue) as any;
    if (!result) return undefined;
    return new SqliteJob(result);
  }

  public async peek(num: number = 100) {
    num = Number(num) || 100; // TS does not validate, so ensure it is a number
    const FutureJobQuery = `
      SELECT id, fingerprint, queue, status, deadlineAt, input, retries, maxRetries, runAfter, lastRanAt, createdAt, error
        FROM job_queue
        WHERE queue = $1
        AND status = 'NEW'
        AND runAfter > NOW()
        ORDER BY runAfter ASC
        LIMIT ${num}`;
    const stmt = db.prepare(FutureJobQuery);
    const ret: Array<SqliteJob> = [];
    const result = stmt.all(this.queue) as any[];
    if (!result) return ret;
    for (const job of result) ret.push(new SqliteJob(job));
    return ret;
  }

  public async next() {
    let id: string | undefined;
    {
      const PendingJobIDQuery = `
      SELECT id
        FROM job_queue
        WHERE queue = $1
        AND status = 'NEW'
        AND runAfter <= NOW()
        LIMIT 1`;
      const stmt = db.prepare(PendingJobIDQuery);
      const result = stmt.get(this.queue) as any;
      if (!result) return undefined;
      id = result.id;
    }
    {
      const UpdateQuery = `
      UPDATE job_queue 
        SET status = 'PROCESSING'
        WHERE id = ? AND queue = ?
        RETURNING *`;
      const stmt = db.prepare(UpdateQuery);
      const result = stmt.get(id, this.queue) as any;
      return new SqliteJob(result);
    }
  }

  public async size(status = JobStatus.PENDING) {
    const sizeQuery = `
      SELECT COUNT(*) as count
        FROM job_queue
        WHERE queue = $1
        AND status = $2
        AND runAfter <= NOW()`;
    const stmt = db.prepare<[queue: string, status: string]>(sizeQuery);
    const result = stmt.get(this.queue, status) as any;
    return result.count;
  }

  public async complete(
    id: unknown,
    output: TaskOutput | null = null,
    error: string | null = null
  ) {
    const job = await this.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    const UpdateQuery = `
      UPDATE job_queue 
        SET output = ?, error = ?, status = ?, retries = retires + 1, lastRanAt = NOW()
        WHERE id = ? AND queue = ?`;
    const status = output
      ? JobStatus.COMPLETED
      : error && job.retries >= job.maxRetries
        ? JobStatus.FAILED
        : JobStatus.PENDING;
    const stmt =
      db.prepare<
        [output: any, error: string | null, status: JobStatus, id: unknown, queue: string]
      >(UpdateQuery);
    stmt.run(output, error, status, id, this.queue);
  }

  public async clear() {
    const ClearQuery = `
      DELETE FROM job_queue
        WHERE queue = ?`;
    const stmt = db.prepare(ClearQuery);
    stmt.run(this.queue);
  }

  public async outputForInput(taskType: string, input: TaskInput) {
    const OutputQuery = `
      SELECT output
        FROM job_queue
        WHERE queue = ? AND taskType = ? AND fingerprint = ? AND status = 'COMPLETED'`;
    const stmt = db.prepare(OutputQuery);
    const result = stmt.get(taskType, makeFingerprint(input)) as any;
    return result;
  }
}

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "./base/ILimiter";
import { JobQueue } from "./base/JobQueue";
import { Job, JobStatus } from "./base/Job";
import { makeFingerprint, toSQLiteTimestamp } from "../util/Misc";
import { type Database } from "bun:sqlite";

// TODO: reuse prepared statements

export class SqliteJobQueue<Input, Output> extends JobQueue<Input, Output> {
  constructor(
    protected db: Database,
    queue: string,
    limiter: ILimiter,
    protected jobClass: typeof Job<Input, Output> = Job<Input, Output>,
    waitDurationInMilliseconds = 100
  ) {
    super(queue, limiter, waitDurationInMilliseconds);
  }

  public ensureTableExists() {
    this.db.exec(`

      CREATE TABLE IF NOT EXISTS job_queue (
        id INTEGER PRIMARY KEY,
        fingerprint text NOT NULL,
        queue text NOT NULL,
        status TEXT NOT NULL default 'NEW',
        taskType TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        retries INTEGER default 0,
        maxRetries INTEGER default 23,
        runAfter TEXT DEFAULT CURRENT_TIMESTAMP,
        lastRanAt TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        deadlineAt TEXT,
        error TEXT
      );
      
      CREATE INDEX IF NOT EXISTS job_queue_fetcher_idx ON job_queue (queue, status, runAfter);
      CREATE INDEX IF NOT EXISTS job_queue_fingerprint_idx ON job_queue (queue, fingerprint, status);

    `);
    return this;
  }

  public createNewJob(results: any): Job<Input, Output> {
    return new this.jobClass({
      ...results,
      input: JSON.parse(results.input) as Input,
      output: results.output ? (JSON.parse(results.output) as Output) : undefined,
      runAfter: results.runAfter ? new Date(results.runAfter + "Z") : undefined,
      createdAt: results.createdAt ? new Date(results.createdAt + "Z") : undefined,
      deadlineAt: results.deadlineAt ? new Date(results.deadlineAt + "Z") : undefined,
      lastRanAt: results.lastRanAt ? new Date(results.lastRanAt + "Z") : undefined,
    });
  }

  public async add(job: Job<Input, Output>) {
    job.queueName = this.queue;
    const fingerprint = await makeFingerprint(job.input);
    job.fingerprint = fingerprint;
    const AddQuery = `
      INSERT INTO job_queue(queue, taskType, fingerprint, input, runAfter, deadlineAt, maxRetries)
		    VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`;
    const stmt = this.db.prepare<
      { id: string },
      [
        queue: string,
        taskType: string,
        fingerpring: string,
        input: string,
        runAfter: string | null,
        deadlineAt: string | null,
        maxRetries: number
      ]
    >(AddQuery);

    const result = stmt.get(
      this.queue,
      job.taskType,
      fingerprint,
      JSON.stringify(job.input),
      toSQLiteTimestamp(job.runAfter),
      toSQLiteTimestamp(job.deadlineAt),
      job.maxRetries
    );
    job.id = result?.id;
    return result?.id;
  }

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

  public async peek(num: number = 100) {
    num = Number(num) || 100; // TS does not validate, so ensure it is a number since we put directly in SQL string
    const FutureJobQuery = `
      SELECT *
        FROM job_queue
        WHERE queue = $1
        AND status = 'NEW'
        AND runAfter > CURRENT_TIMESTAMP
        ORDER BY runAfter ASC
        LIMIT ${num}`;
    const stmt = this.db.prepare(FutureJobQuery);
    const ret: Array<Job<Input, Output>> = [];
    const result = stmt.all(this.queue) as any[];
    for (const job of result || []) ret.push(this.createNewJob(job));
    return ret;
  }

  public async processing() {
    const ProcessingQuery = `
      SELECT *
        FROM job_queue
        WHERE queue = $1
        AND status = 'PROCESSING'`;
    const stmt = this.db.prepare(ProcessingQuery);
    const result = stmt.all(this.queue) as any[];
    const ret: Array<Job<Input, Output>> = [];
    for (const job of result || []) ret.push(this.createNewJob(job));
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
        AND runAfter <= CURRENT_TIMESTAMP
        LIMIT 1`;
      const stmt = this.db.prepare(PendingJobIDQuery);
      const result = stmt.get(this.queue) as any;
      if (!result) return undefined;
      id = result.id;
    }
    if (id) {
      const UpdateQuery = `
      UPDATE job_queue 
        SET status = 'PROCESSING'
        WHERE id = ? AND queue = ?
        RETURNING *`;
      const stmt = this.db.prepare(UpdateQuery);
      const result = stmt.get(id, this.queue) as Job<Input, Output>;
      const job = this.createNewJob(result);
      return job;
    }
  }

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

  public async complete(id: string, output: Output | null = null, error: string | null = null) {
    const job = await this.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    const status = output
      ? JobStatus.COMPLETED
      : error && job.retries >= job.maxRetries
      ? JobStatus.FAILED
      : JobStatus.PENDING;

    const UpdateQuery = `
        UPDATE job_queue 
          SET output = ?, error = ?, status = ?, retries = retries + 1, lastRanAt = CURRENT_TIMESTAMP
          WHERE id = ? AND queue = ?`;

    this.db.exec<
      [output: any, error: string | null, status: JobStatus, id: unknown, queue: string]
    >(UpdateQuery, [JSON.stringify(output), error, status, id, this.queue]);
    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      this.onCompleted(id, status, output, error || undefined);
    }
  }

  public async clear() {
    const ClearQuery = `
      DELETE FROM job_queue
        WHERE queue = ?`;
    const stmt = this.db.prepare(ClearQuery);
    stmt.run(this.queue);
    await this.limiter.clear();
  }

  public async outputForInput(taskType: string, input: Input) {
    const fingerprint = await makeFingerprint(input);
    const OutputQuery = `
      SELECT output
        FROM job_queue
        WHERE queue = ? AND taskType = ? AND fingerprint = ? AND status = 'COMPLETED'`;
    const stmt = this.db.prepare(OutputQuery);
    const result = stmt.get(this.queue, taskType, fingerprint) as { output: string } | undefined;
    return result?.output ? JSON.parse(result.output) : null;
  }
}

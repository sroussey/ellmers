//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import uuid from "uuid";

export enum JobStatus {
  PENDING = "NEW",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

// ============================================================================

export abstract class Job {
  constructor(
    public readonly id: unknown,
    public readonly queue: string,
    public readonly taskName: string,
    public readonly input: any,
    public readonly maxRetries: number,
    public readonly createdAt: Date
  ) {
    this.runAfter = createdAt;
  }
  public status: JobStatus = JobStatus.PENDING;
  public runAfter: Date;
  public output: any = null;
  public retries: number = 0;
  public ranAt: Date | null = null;
  public completedAt: Date | null = null;
  public error: string | undefined = undefined;
}

export abstract class JobQueue {
  public abstract add(job: Job): void;
  public abstract next(): Job | undefined;
  public abstract size(): number;
  public abstract complete(id: unknown, output: any, error?: string): void;
}

// ============================================================================
//                            Local Version
// ============================================================================

export class LocalJob extends Job {
  constructor(queue: string, taskName: string, input: any) {
    const id = uuid.v4();
    const createdAt = new Date();
    const maxRetries = 10;
    super(id, queue, taskName, input, maxRetries, createdAt);
  }
}

export class LocalJobQueue extends JobQueue {
  private readonly queue: LocalJob[] = [];

  #reorderQueue(): void {
    this.queue
      .filter((job) => job.status === JobStatus.PENDING)
      .filter((job) => job.runAfter.getTime() <= Date.now())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public add(job: Job): void {
    this.queue.push(job);
  }

  public next(): Job | undefined {
    this.#reorderQueue();

    const job = this.queue[0];
    job.status = JobStatus.PROCESSING;
    return job;
  }

  public size(): number {
    return this.queue.length;
  }

  public complete(id: unknown, output: any, error?: string): void {
    const job = this.queue.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    job.completedAt = new Date();
    if (error) {
      job.status = JobStatus.FAILED;
      job.error = error;
    } else {
      job.status = JobStatus.COMPLETED;
      job.output = output;
    }
  }
}

// ============================================================================
//          PostgreSQL Version (idea for, never executed, todo)
// ============================================================================

/*

CREATE TABLE IF NOT EXISTS job_queue (
		id bigint SERIAL NOT NULL,
		fingerprint text NOT NULL,
		queue text NOT NULL,
		status job_status NOT NULL default 'new',
		payload jsonb,
    output jsonb,
		retries integer default 0,
		max_retries integer default 23,
		run_after timestamp with time zone DEFAULT now(),
		ran_at timestamp with time zone,
		created_at timestamp with time zone DEFAULT now(),
		error text
);

CREATE INDEX IF NOT EXISTS job_fetcher_idx ON job_queue (id, status, run_after);
CREATE INDEX IF NOT EXISTS job_queue_fetcher_idx ON job_queue (queue, status, run_after);
CREATE INDEX IF NOT EXISTS job_queue_fingerprint_idx ON job_queue (fingerprint, status);

--- we could return results from the existing job instead of queuing a new one if we wanted to, not sure, weird way to cache, todo
CREATE UNIQUE INDEX IF NOT EXISTS jobs_fingerprint_unique_idx ON job_queue (fingerprint, status) WHERE NOT (status = 'processed');

*/

export class PostgresqlJob extends Job {
  constructor(queue: string, taskName: string, input: any) {
    const id = uuid.v4();
    const createdAt = new Date();
    const maxRetries = 10;
    super(id, queue, taskName, input, maxRetries, createdAt);
  }
}

export class PostgresqlJobQueue extends JobQueue {
  public add(job: Job): void {
    const AddQuery = `
      INSERT INTO job_queue(queue, fingerprint, payload, run_after, deadline, max_retries)
		    VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id`;
  }

  public get(): Job | undefined {
    const JobQuery = `
      SELECT id, fingerprint, queue, status, deadline, payload, retries, max_retries, run_after, ran_at, created_at, error
        FROM job_queue
        WHERE id = $1
        FOR UPDATE SKIP LOCKED
        LIMIT 1`;

    return;
  }

  public peek(num: number = 100): Job | undefined {
    num = Number(num) || 100;
    const FutureJobQuery = `
      SELECT id, fingerprint, queue, status, deadline, payload, retries, max_retries, run_after, ran_at, created_at, error
        FROM job_queue
        WHERE queue = $1
        AND status = 'new'
        AND run_after > NOW()
        ORDER BY run_after ASC
        LIMIT ${num}
        FOR UPDATE SKIP LOCKED`;

    return;
  }

  public next(): Job | undefined {
    const PendingJobIDQuery = `
      SELECT id
        FROM job_queue
        WHERE queue = $1
        AND status = 'new'
        AND run_after <= NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT 1`;

    return;
  }

  public size(): number {
    // why do we even care about size?
    return 0;
  }

  #update(id: unknown, output: any, error?: string): void {
    const UpdateQuery = `
      UPDATE job_queue 
        SET ...
        WHERE id = ...`;
  }

  public complete(id: unknown, output: any, error?: string): void {
    //
  }
}

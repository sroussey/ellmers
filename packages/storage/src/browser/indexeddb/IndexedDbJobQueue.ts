//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { nanoid } from "nanoid";
import {
  Job,
  JobQueue,
  ILimiter,
  JobError,
  RetryableJobError,
  PermanentJobError,
  JobStatus,
} from "ellmers-core";
import { makeFingerprint } from "../../util/Misc";
import { ensureIndexedDbTable, ExpectedIndexDefinition } from "./base/IndexedDbTable";

/**
 * IndexedDB implementation of a job queue.
 * Provides storage and retrieval for job execution states using IndexedDB.
 */
export class IndexedDbJobQueue<Input, Output> extends JobQueue<Input, Output> {
  private dbPromise: Promise<IDBDatabase>;
  private tableName: string;
  constructor(
    tableNamePrefix: string,
    queue: string,
    limiter: ILimiter,
    jobClass: typeof Job<Input, Output> = Job<Input, Output>,
    waitDurationInMilliseconds: number = 100,
    public version: number = 1
  ) {
    super(queue, limiter, jobClass, waitDurationInMilliseconds);
    this.tableName = `${tableNamePrefix}_${queue}`;

    // Close any existing connections first
    const closeRequest = indexedDB.open(this.tableName);
    closeRequest.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.close();
    };

    const expectedIndexes: ExpectedIndexDefinition[] = [
      {
        name: "status",
        keyPath: `value.status`,
        options: { unique: false },
      },
      {
        name: "status_runAfter",
        keyPath: ["status", "runAfter"],
        options: { unique: false },
      },
      {
        name: "jobRunId",
        keyPath: `jobRunId`,
        options: { unique: false },
      },
      {
        name: "fingerprint_status",
        keyPath: ["fingerprint", "status"],
        options: { unique: false },
      },
    ];

    // Now initialize the database
    this.dbPromise = ensureIndexedDbTable(this.tableName, "id", expectedIndexes);
  }

  async add(job: Job<Input, Output>): Promise<unknown> {
    job.id = job.id ?? nanoid();
    job.jobRunId = job.jobRunId ?? nanoid();
    job.queueName = this.queue;
    job.fingerprint = await makeFingerprint(job.input);
    job.status = JobStatus.PENDING;
    job.progress = 0;
    job.progressMessage = "";
    job.progressDetails = null;
    job.queue = this;

    this.createAbortController(job.id);

    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const request = store.add({
      id: job.id,
      jobRunId: job.jobRunId,
      queueName: this.queue,
      fingerprint: job.fingerprint,
      input: job.input,
      status: job.status,
      output: job.output,
      error: job.error,
      errorCode: job.errorCode,
      retries: job.retries,
      runAfter: job.runAfter,
      createdAt: job.createdAt,
      progress: job.progress,
      progressMessage: job.progressMessage,
      progressDetails: job.progressDetails,
    });

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(job.id);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(id: unknown): Promise<Job<Input, Output> | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const request = store.get(id as string);
    return new Promise((resolve, reject) => {
      request.onsuccess = () =>
        resolve(request.result ? this.createNewJob(request.result, false) : undefined);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async peek(num: number = 100): Promise<Job<Input, Output>[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("status_runAfter");
    const request = index.getAll(IDBKeyRange.only([JobStatus.PENDING]), num);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const ret: Array<Job<Input, Output>> = [];
        for (const job of request.result || []) ret.push(this.createNewJob(job, false));
        resolve(ret);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async processing(): Promise<Job<Input, Output>[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("status");
    const request = index.getAll(IDBKeyRange.only(JobStatus.PROCESSING));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const ret: Array<Job<Input, Output>> = [];
        for (const job of request.result || []) ret.push(this.createNewJob(job, false));
        resolve(ret);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async aborting(): Promise<Job<Input, Output>[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("status");
    const request = index.getAll(IDBKeyRange.only(JobStatus.ABORTING));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const ret: Array<Job<Input, Output>> = [];
        for (const job of request.result || []) ret.push(this.createNewJob(job, false));
        resolve(ret);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async next(): Promise<Job<Input, Output> | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const index = store.index("status_runAfter");
    const now = new Date();

    return new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(
        IDBKeyRange.bound([JobStatus.PENDING, 0], [JobStatus.PENDING, now], false, true)
      );

      cursorRequest.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          resolve(undefined);
          return;
        }

        const job = cursor.value;
        // Verify the job is still in PENDING state
        if (job.status !== JobStatus.PENDING) {
          cursor.continue();
          return;
        }

        job.status = JobStatus.PROCESSING;
        job.processingStarted = now;

        try {
          const updateRequest = store.put(job);
          updateRequest.onsuccess = () => {
            return job ? resolve(this.createNewJob(job, false)) : resolve(undefined);
          };
          updateRequest.onerror = (err) => {
            console.error("Failed to update job status:", err);
            cursor.continue();
          };
        } catch (err) {
          console.error("Error updating job:", err);
          cursor.continue();
        }
      };

      cursorRequest.onerror = () => reject(cursorRequest.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Retrieves the number of jobs in the queue.
   * Returns the count of jobs in the queue.
   */
  async size(): Promise<number> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const request = store.count();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Marks a job as complete with its output or error.
   * Uses enhanced error handling to update the job's status.
   * If a retryable error occurred, the job's retry count is incremented and its runAfter updated.
   */
  async complete(id: unknown, output?: Output, error?: JobError): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const request = store.get(id as string);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const job = request.result;
        if (!job) {
          reject(new Error(`Job ${id} not found`));
          return;
        }
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

        const updateRequest = store.put(job);
        updateRequest.onsuccess = () => {
          if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
            this.onCompleted(job.id, job.status, output, error);
          }
          resolve();
        };
        updateRequest.onerror = () => reject(updateRequest.error);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Aborts a job by setting its status to "ABORTING".
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  public async abort(jobId: unknown): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const request = store.get(jobId as string);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const job = request.result;
        if (!job) {
          reject(new Error(`Job ${jobId} not found`));
          return;
        }

        job.status = JobStatus.ABORTING;
        const updateRequest = store.put(job);
        updateRequest.onsuccess = () => {
          this.abortJob(jobId);
          resolve();
        };
        updateRequest.onerror = () => reject(updateRequest.error);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getJobsByRunId(jobRunId: string): Promise<Job<Input, Output>[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const request = store.index("jobRunId").getAll(jobRunId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const ret: Array<Job<Input, Output>> = [];
        for (const job of request.result || []) ret.push(this.createNewJob(job, false));
        resolve(ret);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Clears all jobs from the queue.
   */
  async deleteAll(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const request = store.clear();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Retrieves the output for a job based input.
   * Uses a compound key to query the IndexedDB for the job's output.
   */
  async outputForInput(input: Input): Promise<Output | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const fingerprint = await makeFingerprint(input);
    const index = store.index("fingerprint_status");
    const request = index.get([fingerprint, JobStatus.COMPLETED]);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.output : null);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
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
    const db = await this.dbPromise;
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const request = store.get(jobId as string);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const job = request.result;
        if (!job) {
          reject(new Error(`Job ${jobId} not found`));
          return;
        }

        job.progress = progress;
        job.progressMessage = message;
        job.progressDetails = details;

        const updateRequest = store.put(job);
        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }
}

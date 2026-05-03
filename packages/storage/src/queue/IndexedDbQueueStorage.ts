/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, deepEqual, makeFingerprint, uuid4 } from "@workglow/util";
import { HybridSubscriptionManager } from "../util/HybridSubscriptionManager";
import {
  ensureIndexedDbTable,
  ExpectedIndexDefinition,
  MigrationOptions,
} from "../util/IndexedDbTable";
import {
  IQueueStorage,
  JobStatus,
  JobStorageFormat,
  PrefixColumn,
  QueueChangePayload,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "./IQueueStorage";

export const INDEXED_DB_QUEUE_STORAGE = createServiceToken<IQueueStorage<any, any>>(
  "jobqueue.storage.indexedDb"
);

/**
 * Extended options for IndexedDB queue storage including prefix support
 */
export interface IndexedDbQueueStorageOptions extends QueueStorageOptions, MigrationOptions {
  /** Enable BroadcastChannel notifications (default: true) */
  readonly useBroadcastChannel?: boolean;
  /** Backup polling interval in ms (default: 5000, 0 to disable) */
  readonly backupPollingIntervalMs?: number;
}

/**
 * IndexedDB implementation of a job queue storage.
 * Provides storage and retrieval for job execution states using IndexedDB.
 */
export class IndexedDbQueueStorage<Input, Output> implements IQueueStorage<Input, Output> {
  public readonly scope = "process" as const;
  private db: IDBDatabase | undefined;
  private readonly tableName: string;
  private readonly migrationOptions: MigrationOptions;
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** Shared hybrid subscription manager */
  private hybridManager: HybridSubscriptionManager<
    JobStorageFormat<Input, Output>,
    unknown,
    QueueChangePayload<Input, Output>
  > | null = null;
  /** Hybrid subscription options */
  private readonly hybridOptions: {
    readonly useBroadcastChannel: boolean;
    readonly backupPollingIntervalMs: number;
  };

  constructor(
    public readonly queueName: string,
    options: IndexedDbQueueStorageOptions = {}
  ) {
    this.migrationOptions = options;
    this.prefixes = options.prefixes ?? [];
    this.prefixValues = options.prefixValues ?? {};
    this.hybridOptions = {
      useBroadcastChannel: options.useBroadcastChannel ?? true,
      backupPollingIntervalMs: options.backupPollingIntervalMs ?? 5000,
    };
    // Generate table name based on prefix configuration to avoid conflicts
    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.tableName = `jobs_${prefixNames}`;
    } else {
      this.tableName = "jobs";
    }
  }

  /**
   * Gets prefix column names for use in indexes
   */
  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  /**
   * Checks if a job matches the current prefix values
   */
  private matchesPrefixes(job: JobStorageFormat<Input, Output> & Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(this.prefixValues)) {
      if (job[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gets prefix values as an array in column order for index key construction
   */
  private getPrefixKeyValues(): Array<string | number> {
    return this.prefixes.map((p) => this.prefixValues[p.name]);
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    await this.setupDatabase();
    return this.db!;
  }

  /**
   * Sets up the IndexedDB database table with the required schema and indexes.
   * Must be called before using any other methods.
   */
  public async setupDatabase(): Promise<void> {
    const prefixColumnNames = this.getPrefixColumnNames();

    // Build index key paths with prefixes prepended
    const buildKeyPath = (basePath: string[]): string[] => {
      return [...prefixColumnNames, ...basePath];
    };

    const expectedIndexes: ExpectedIndexDefinition[] = [
      {
        name: "queue_status",
        keyPath: buildKeyPath(["queue", "status"]),
        options: { unique: false },
      },
      {
        name: "queue_status_run_after",
        keyPath: buildKeyPath(["queue", "status", "run_after"]),
        options: { unique: false },
      },
      {
        name: "queue_job_run_id",
        keyPath: buildKeyPath(["queue", "job_run_id"]),
        options: { unique: false },
      },
      {
        name: "queue_fingerprint_status",
        keyPath: buildKeyPath(["queue", "fingerprint", "status"]),
        options: { unique: false },
      },
    ];

    this.db = await ensureIndexedDbTable(
      this.tableName,
      "id",
      expectedIndexes,
      this.migrationOptions
    );
  }

  /**
   * Adds a job to the queue.
   * @param job - The job to add to the queue.
   * @returns A promise that resolves to the job id.
   */
  public async add(job: JobStorageFormat<Input, Output>): Promise<unknown> {
    const db = await this.getDb();
    const now = new Date().toISOString();
    const jobWithPrefixes = job as JobStorageFormat<Input, Output> & Record<string, unknown>;
    jobWithPrefixes.id = jobWithPrefixes.id ?? uuid4();
    jobWithPrefixes.job_run_id = jobWithPrefixes.job_run_id ?? uuid4();
    jobWithPrefixes.queue = this.queueName;
    jobWithPrefixes.fingerprint = await makeFingerprint(jobWithPrefixes.input);
    jobWithPrefixes.status = JobStatus.PENDING;
    jobWithPrefixes.progress = 0;
    jobWithPrefixes.progress_message = "";
    jobWithPrefixes.progress_details = null;
    jobWithPrefixes.created_at = now;
    jobWithPrefixes.run_after = now;

    // Add prefix values to the job
    for (const [key, value] of Object.entries(this.prefixValues)) {
      jobWithPrefixes[key] = value;
    }

    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);

    return new Promise((resolve, reject) => {
      const request = store.add(jobWithPrefixes);

      // Don't resolve until transaction is complete
      tx.oncomplete = () => {
        // Notify hybrid manager of local change
        this.hybridManager?.notifyLocalChange();
        resolve(jobWithPrefixes.id);
      };
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieves a job from the queue by its id.
   * @param id - The id of the job to retrieve.
   * @returns A promise that resolves to the job or undefined if the job is not found.
   */
  async get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const request = store.get(id as string);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const job = request.result as
          | (JobStorageFormat<Input, Output> & Record<string, unknown>)
          | undefined;
        // Filter by queue name and prefix values to ensure job belongs to this queue
        if (job && job.queue === this.queueName && this.matchesPrefixes(job)) {
          resolve(job);
        } else {
          resolve(undefined);
        }
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Retrieves a slice of jobs from the queue.
   * @param status - The status of the jobs to retrieve.
   * @param num - The number of jobs to retrieve.
   * @returns A promise that resolves to an array of jobs.
   */
  public async peek(
    status: JobStatus = JobStatus.PENDING,
    num: number = 100
  ): Promise<JobStorageFormat<Input, Output>[]> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_status_run_after");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      const ret = new Map<unknown, JobStorageFormat<Input, Output>>();
      // Create a key range for the compound index: from [prefixes..., queue, status, ""] to [prefixes..., queue, status, "\uffff"]
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, this.queueName, status, ""],
        [...prefixKeyValues, this.queueName, status, "\uffff"]
      );
      const cursorRequest = index.openCursor(keyRange);

      const handleCursor = (e: Event) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor || ret.size >= num) {
          resolve(Array.from(ret.values()));
          return;
        }
        const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
        // Verify prefix match and use Map to ensure no duplicates by job ID
        if (this.matchesPrefixes(job)) {
          ret.set(cursor.value.id, cursor.value);
        }
        cursor.continue();
      };

      cursorRequest.onsuccess = handleCursor;
      cursorRequest.onerror = () => reject(cursorRequest.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Retrieves the next job from the queue using optimistic locking. In case multiple workers
   * claim the same job, the first worker to claim it will process it and the other workers will return undefined.
   * This ONLY happens if workers are running in multiple tabs.
   *
   * IndexedDB uses snapshot isolation, so concurrent transactions can both see the same
   * PENDING job. To prevent processing the same job multiple times, this method:
   * 1. Claims a job by setting it to PROCESSING with a unique claim token
   * 2. After the transaction completes, re-reads the job to verify the claim succeeded
   * 3. If another worker claimed it first (different claim token), returns undefined
   *
   * @param workerId - Worker ID to associate with the job (required)
   * @returns A promise that resolves to the next job or undefined if the queue is empty.
   */
  public async next(workerId: string): Promise<JobStorageFormat<Input, Output> | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_status_run_after");
    const now = new Date().toISOString();
    const prefixKeyValues = this.getPrefixKeyValues();

    // This ensures we can verify that we actually won the race to claim this job
    const claimToken = workerId;

    const jobToReturn = await new Promise<JobStorageFormat<Input, Output> | undefined>(
      (resolve, reject) => {
        const cursorRequest = index.openCursor(
          IDBKeyRange.bound(
            [...prefixKeyValues, this.queueName, JobStatus.PENDING, ""],
            [...prefixKeyValues, this.queueName, JobStatus.PENDING, now],
            false,
            false
          )
        );

        let claimedJob: JobStorageFormat<Input, Output> | undefined;
        let cursorStopped = false;

        cursorRequest.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) {
            // Cursor exhausted - resolve with whatever we found (or undefined)
            return;
          }

          // If we already found and updated a job, stop iterating
          if (cursorStopped) {
            return;
          }

          const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
          // Verify the job belongs to this queue, matches prefixes, and is still in PENDING state
          if (
            job.queue !== this.queueName ||
            job.status !== JobStatus.PENDING ||
            !this.matchesPrefixes(job)
          ) {
            cursor.continue();
            return;
          }

          // Claim the job with our unique token
          job.status = JobStatus.PROCESSING;
          job.last_ran_at = now;
          job.worker_id = claimToken;

          try {
            const updateRequest = store.put(job);
            updateRequest.onsuccess = () => {
              claimedJob = job;
              cursorStopped = true;
              // Stop cursor iteration - we've claimed a job
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

        // Wait for transaction to complete before resolving
        tx.oncomplete = () => {
          // Notify hybrid manager of local change
          if (claimedJob) {
            this.hybridManager?.notifyLocalChange();
          }
          resolve(claimedJob);
        };
        tx.onerror = () => reject(tx.error);
      }
    );

    // If we didn't find any job to claim, return undefined
    if (!jobToReturn) {
      return undefined;
    }

    // Verify we actually won the race by re-reading the job
    // This is the optimistic locking check - if another worker claimed it first,
    // their claim token will be there instead of ours
    const verifiedJob = await this.get(jobToReturn.id);

    if (!verifiedJob) {
      // Job was deleted - we lost the race
      return undefined;
    }

    if (verifiedJob.worker_id !== claimToken) {
      // Another worker claimed this job - we lost the race
      return undefined;
    }

    if (verifiedJob.status !== JobStatus.PROCESSING) {
      // Job status changed (e.g., another worker completed it already) - we lost the race
      return undefined;
    }

    // We successfully claimed the job
    return verifiedJob;
  }

  /**
   * Retrieves the number of jobs in the queue.
   * Returns the count of jobs in the queue.
   */
  public async size(status = JobStatus.PENDING): Promise<number> {
    const db = await this.getDb();
    const prefixKeyValues = this.getPrefixKeyValues();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.tableName, "readonly");
      const store = tx.objectStore(this.tableName);
      const index = store.index("queue_status");
      const keyRange = IDBKeyRange.only([...prefixKeyValues, this.queueName, status]);
      const request = index.count(keyRange);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Marks a job as complete with its output or error.
   */
  public async complete(job: JobStorageFormat<Input, Output>): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);

    return new Promise((resolve, reject) => {
      const getReq = store.get(job.id as string);
      getReq.onsuccess = () => {
        const existing = getReq.result as
          | (JobStorageFormat<Input, Output> & Record<string, unknown>)
          | undefined;
        // Verify job belongs to this queue and matches prefixes
        if (!existing || existing.queue !== this.queueName || !this.matchesPrefixes(existing)) {
          reject(
            new Error(`Job ${job.id} not found or does not belong to queue ${this.queueName}`)
          );
          return;
        }
        const currentAttempts = existing.run_attempts ?? 0;
        job.run_attempts = currentAttempts + 1;
        // Ensure queue is set correctly
        job.queue = this.queueName;

        // Ensure prefix values are preserved
        const jobWithPrefixes = job as JobStorageFormat<Input, Output> & Record<string, unknown>;
        for (const [key, value] of Object.entries(this.prefixValues)) {
          jobWithPrefixes[key] = value;
        }

        const putReq = store.put(jobWithPrefixes);
        putReq.onsuccess = () => {};
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);

      // Don't resolve until transaction is complete
      tx.oncomplete = () => {
        // Notify hybrid manager of local change
        this.hybridManager?.notifyLocalChange();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Releases a claimed job without consuming a retry attempt.
   */
  public async release(id: unknown): Promise<void> {
    const job = await this.get(id);
    if (!job) return;

    job.status = JobStatus.PENDING;
    job.worker_id = null;
    job.progress = 0;
    job.progress_message = "";
    job.progress_details = null;

    await this.put(job);
  }

  /**
   * Aborts a job in the queue.
   */
  public async abort(id: unknown): Promise<void> {
    const job = await this.get(id);
    if (!job) return;

    job.status = JobStatus.ABORTING;
    await this.complete(job);
  }

  /**
   * Gets jobs by their run ID.
   */
  public async getByRunId(job_run_id: string): Promise<JobStorageFormat<Input, Output>[]> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_job_run_id");
    const prefixKeyValues = this.getPrefixKeyValues();
    const keyRange = IDBKeyRange.only([...prefixKeyValues, this.queueName, job_run_id]);
    const request = index.getAll(keyRange);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        // Filter results to ensure they match prefixes
        const results = (request.result || []).filter(
          (job: JobStorageFormat<Input, Output> & Record<string, unknown>) =>
            this.matchesPrefixes(job)
        );
        resolve(results);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Deletes all jobs from the queue.
   */
  public async deleteAll(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_status");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      // Use a cursor to iterate through all jobs for this queue with prefix
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, this.queueName, ""],
        [...prefixKeyValues, this.queueName, "\uffff"]
      );
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
          // Verify job belongs to this queue and matches prefixes before deleting
          if (job.queue === this.queueName && this.matchesPrefixes(job)) {
            const deleteRequest = cursor.delete();
            deleteRequest.onsuccess = () => {
              cursor.continue();
            };
            deleteRequest.onerror = () => {
              // Continue even if delete fails
              cursor.continue();
            };
          } else {
            cursor.continue();
          }
        }
      };

      tx.oncomplete = () => {
        // Notify hybrid manager of local change
        this.hybridManager?.notifyLocalChange();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Gets the output for a given input.
   */
  public async outputForInput(input: Input): Promise<Output | null> {
    const fingerprint = await makeFingerprint(input);
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_fingerprint_status");
    const prefixKeyValues = this.getPrefixKeyValues();
    const request = index.get([
      ...prefixKeyValues,
      this.queueName,
      fingerprint,
      JobStatus.COMPLETED,
    ]);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const job = request.result as
          | (JobStorageFormat<Input, Output> & Record<string, unknown>)
          | undefined;
        if (job && this.matchesPrefixes(job)) {
          resolve(job.output ?? null);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Saves progress updates for a job.
   */
  public async saveProgress(
    id: unknown,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void> {
    const job = await this.get(id);
    if (!job) throw new Error(`Job ${id} not found`);

    job.progress = progress;
    job.progress_message = message;
    job.progress_details = details;

    await this.put(job);
  }

  /**
   * Persists a job to the store without modifying run_attempts or other completion logic.
   */
  private async put(job: JobStorageFormat<Input, Output>): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);

    // Ensure queue is set correctly
    job.queue = this.queueName;

    // Ensure prefix values are preserved
    const jobWithPrefixes = job as JobStorageFormat<Input, Output> & Record<string, unknown>;
    for (const [key, value] of Object.entries(this.prefixValues)) {
      jobWithPrefixes[key] = value;
    }

    return new Promise((resolve, reject) => {
      const putReq = store.put(jobWithPrefixes);
      putReq.onerror = () => reject(putReq.error);
      tx.oncomplete = () => {
        // Notify hybrid manager of local change
        this.hybridManager?.notifyLocalChange();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Deletes a job by its ID.
   */
  public async delete(id: unknown): Promise<void> {
    const job = await this.get(id);
    if (!job) return;

    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const request = store.delete(id as string);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => {
        // Notify hybrid manager of local change
        this.hybridManager?.notifyLocalChange();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Delete jobs with a specific status older than a cutoff date
   * @param status - Status of jobs to delete
   * @param olderThanMs - Delete jobs completed more than this many milliseconds ago
   */
  public async deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_status");
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();
    const prefixKeyValues = this.getPrefixKeyValues();
    const keyRange = IDBKeyRange.only([...prefixKeyValues, this.queueName, status]);

    return new Promise((resolve, reject) => {
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
          // Verify job belongs to this queue, matches prefixes, and matches criteria
          if (
            job.queue === this.queueName &&
            this.matchesPrefixes(job) &&
            job.status === status &&
            job.completed_at &&
            job.completed_at <= cutoffDate
          ) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        // Notify hybrid manager of local change
        this.hybridManager?.notifyLocalChange();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Gets all jobs from the queue that match the current prefix values.
   * Used internally for normal polling-based subscriptions (efficient - filters at DB level).
   *
   * @returns A promise that resolves to an array of jobs
   */
  private async getAllJobs(): Promise<Array<JobStorageFormat<Input, Output>>> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);
    const index = store.index("queue_status");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      const jobs: Array<JobStorageFormat<Input, Output>> = [];
      // Use a key range that covers all statuses for this queue with prefixes
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, this.queueName, ""],
        [...prefixKeyValues, this.queueName, "\uffff"]
      );
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
          if (job.queue === this.queueName && this.matchesPrefixes(job)) {
            jobs.push(job);
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(jobs);
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Gets all jobs from the queue with a custom prefix filter.
   * Used for subscriptions with custom prefix filters (filters at DB level where possible).
   *
   * @param prefixFilter - The prefix values to filter by (empty object = all jobs)
   * @returns A promise that resolves to an array of jobs
   */
  private async getAllJobsWithFilter(
    prefixFilter: Readonly<Record<string, string | number>>
  ): Promise<Array<JobStorageFormat<Input, Output>>> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readonly");
    const store = tx.objectStore(this.tableName);

    return new Promise((resolve, reject) => {
      const jobs: Array<JobStorageFormat<Input, Output>> = [];
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
          // Filter by queue name
          if (job.queue !== this.queueName) {
            cursor.continue();
            return;
          }
          // If empty filter, include all jobs for this queue
          if (Object.keys(prefixFilter).length === 0) {
            jobs.push(job);
          } else {
            // Check each filter value
            let matches = true;
            for (const [key, value] of Object.entries(prefixFilter)) {
              if (job[key] !== value) {
                matches = false;
                break;
              }
            }
            if (matches) {
              jobs.push(job);
            }
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(jobs);
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Checks if a prefix filter is custom (different from instance's prefixes).
   */
  private isCustomPrefixFilter(prefixFilter?: Readonly<Record<string, string | number>>): boolean {
    // No filter specified - use instance prefixes (not custom)
    if (prefixFilter === undefined) {
      return false;
    }
    // Empty filter - receive all (custom)
    if (Object.keys(prefixFilter).length === 0) {
      return true;
    }
    // Check if filter matches instance prefixes exactly
    const instanceKeys = Object.keys(this.prefixValues);
    const filterKeys = Object.keys(prefixFilter);
    if (instanceKeys.length !== filterKeys.length) {
      return true; // Different number of keys = custom
    }
    for (const key of instanceKeys) {
      if (this.prefixValues[key] !== prefixFilter[key]) {
        return true; // Different value = custom
      }
    }
    return false; // Matches instance prefixes exactly
  }

  /**
   * Gets or creates the shared hybrid subscription manager for normal subscriptions.
   * This ensures all normal subscriptions share a single manager.
   */
  private getHybridManager(): HybridSubscriptionManager<
    JobStorageFormat<Input, Output>,
    unknown,
    QueueChangePayload<Input, Output>
  > {
    if (!this.hybridManager) {
      // Generate unique channel name based on queue name and table name
      const channelName = `indexeddb-queue-${this.tableName}-${this.queueName}`;

      this.hybridManager = new HybridSubscriptionManager<
        JobStorageFormat<Input, Output>,
        unknown,
        QueueChangePayload<Input, Output>
      >(
        channelName,
        async () => {
          // Fetch jobs with instance's prefix filter (efficient DB-level filtering)
          const jobs = await this.getAllJobs();
          return new Map(jobs.map((j) => [j.id, j]));
        },
        (a, b) => deepEqual(a, b),
        {
          insert: (item) => ({ type: "INSERT" as const, new: item }),
          update: (oldItem, newItem) => ({ type: "UPDATE" as const, old: oldItem, new: newItem }),
          delete: (item) => ({ type: "DELETE" as const, old: item }),
        },
        {
          defaultIntervalMs: 1000,
          useBroadcastChannel: this.hybridOptions.useBroadcastChannel,
          backupPollingIntervalMs: this.hybridOptions.backupPollingIntervalMs,
        }
      );
    }
    return this.hybridManager;
  }

  /**
   * Creates a dedicated polling subscription for custom prefix filters.
   * This runs separately from the normal polling manager.
   */
  private subscribeWithCustomPrefixFilter(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    prefixFilter: Readonly<Record<string, string | number>>,
    intervalMs: number
  ): () => void {
    let lastKnownJobs = new Map<unknown, JobStorageFormat<Input, Output>>();
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const currentJobs = await this.getAllJobsWithFilter(prefixFilter);
        if (cancelled) return;
        const currentMap = new Map(currentJobs.map((j) => [j.id, j]));

        // Detect changes
        for (const [id, job] of currentMap) {
          const old = lastKnownJobs.get(id);
          if (!old) {
            callback({ type: "INSERT", new: job });
          } else if (!deepEqual(old, job)) {
            callback({ type: "UPDATE", old, new: job });
          }
        }

        for (const [id, job] of lastKnownJobs) {
          if (!currentMap.has(id)) {
            callback({ type: "DELETE", old: job });
          }
        }

        lastKnownJobs = currentMap;
      } catch {
        // Ignore polling errors
      }
    };

    const intervalId = setInterval(poll, intervalMs);
    poll(); // Initial poll

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }

  /**
   * Subscribes to changes in the queue.
   * Uses polling since IndexedDB has no native cross-tab change notifications.
   *
   * Normal subscriptions (no custom prefix filter) share a single polling loop for efficiency.
   * Custom prefix filter subscriptions get their own dedicated polling loop with DB-level filtering.
   *
   * @param callback - Function called when a change occurs
   * @param options - Subscription options including polling interval and prefix filter
   * @returns Unsubscribe function
   */
  public subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    const intervalMs = options?.pollingIntervalMs ?? 1000;

    // Check if this is a custom prefix filter subscription
    if (this.isCustomPrefixFilter(options?.prefixFilter)) {
      // Custom prefix filter - use dedicated polling with DB-level filtering
      return this.subscribeWithCustomPrefixFilter(callback, options!.prefixFilter!, intervalMs);
    }

    // Normal subscription - use shared hybrid manager (efficient)
    const manager = this.getHybridManager();
    return manager.subscribe(callback, { intervalMs });
  }

  /**
   * Cleanup method to destroy the hybrid manager
   */
  destroy(): void {
    if (this.hybridManager) {
      this.hybridManager.destroy();
      this.hybridManager = null;
    }
  }
}

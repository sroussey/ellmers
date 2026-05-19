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
import { HybridSubscriptionManager } from "@workglow/storage";
import { createServiceToken, deepEqual, makeFingerprint, uuid4 } from "@workglow/util";
import { IndexedDbMigrationRunner } from "../migrations/IndexedDbMigrationRunner";
import { indexedDbQueueMigrations } from "../migrations/indexedDbQueueMigrations";
import { openIdb } from "../storage/openIdb";

export const INDEXED_DB_QUEUE_STORAGE = createServiceToken<IQueueStorage<any, any>>(
  "jobqueue.storage.indexedDb"
);

/**
 * Extended options for IndexedDB queue storage including prefix support.
 */
export interface IndexedDbQueueStorageOptions extends QueueStorageOptions {
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
    await this.migrate();
    return this.db!;
  }

  /**
   * Returns the versioned migrations that this storage's object store +
   * indexes depend on. Callers can compose them with other storages'
   * migrations under a shared {@link IndexedDbMigrationRunner}; otherwise
   * call {@link migrate}.
   */
  public getMigrations() {
    return indexedDbQueueMigrations(this.tableName, this.prefixes);
  }

  /**
   * Applies any pending migrations for this queue's IndexedDB database, then
   * opens a long-lived connection at the migrated version. Idempotent — a
   * second call closes any prior handle (so it doesn't pin the
   * pre-migration version or block another tab's upgrade), reruns the
   * runner (no-op if the bookkeeping store says everything is applied), and
   * reopens the connection.
   */
  public async migrate(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore — close is best-effort
      }
      this.db = undefined;
    }
    const runner = new IndexedDbMigrationRunner(this.tableName);
    await runner.run(this.getMigrations());
    this.db = await openIdb(this.tableName);
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
    jobWithPrefixes.visible_at = now;

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
    const index = store.index("queue_status_visible_at");
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
   * Retrieves the next job from the queue using optimistic locking.
   * Claims PENDING jobs ready to run, and also reclaims PROCESSING jobs whose
   * lease has expired (crash recovery). Sets lease_expires_at on the claimed row.
   *
   * IndexedDB uses snapshot isolation, so concurrent transactions can both see the same
   * PENDING job. To prevent processing the same job multiple times, this method:
   * 1. Claims a job by setting it to PROCESSING with a unique claim token
   * 2. After the transaction completes, re-reads the job to verify the claim succeeded
   * 3. If another worker claimed it first (different claim token), returns undefined
   *
   * @param workerId - Worker ID to associate with the job (required)
   * @param opts - Optional options including leaseMs (default 30000)
   * @returns A promise that resolves to the next job or undefined if the queue is empty.
   */
  public async next(
    workerId: string,
    opts?: { leaseMs?: number }
  ): Promise<JobStorageFormat<Input, Output> | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const now = new Date().toISOString();
    const leaseMs = opts?.leaseMs ?? 30000;
    const leaseExpiry = new Date(Date.now() + leaseMs).toISOString();
    const prefixKeyValues = this.getPrefixKeyValues();

    // This ensures we can verify that we actually won the race to claim this job
    const claimToken = workerId;

    const jobToReturn = await new Promise<JobStorageFormat<Input, Output> | undefined>(
      (resolve, reject) => {
        let claimedJob: JobStorageFormat<Input, Output> | undefined;

        const tryClaimJob = (job: JobStorageFormat<Input, Output> & Record<string, unknown>) => {
          // Lease-expiry reclaim consumes one attempt against max_attempts;
          // a fresh PENDING claim does not (the worker's validateJobState
          // FAILs the job when attempts >= max_attempts on the next step).
          const isLeaseExpiryReclaim = job.status === JobStatus.PROCESSING;
          job.status = JobStatus.PROCESSING;
          job.last_attempted_at = now;
          job.lease_owner = claimToken;
          job.lease_expires_at = leaseExpiry;
          if (isLeaseExpiryReclaim) {
            job.attempts = ((job.attempts as number | undefined) ?? 0) + 1;
          }
          // Always clear stale abort_requested_at on (re)claim. A PROCESSING
          // row may have had abort_requested_at set before the previous
          // worker crashed; the new owner must start with a clean slate.
          job.abort_requested_at = null;

          try {
            const updateRequest = store.put(job);
            updateRequest.onsuccess = () => {
              claimedJob = job;
            };
            updateRequest.onerror = () => {};
          } catch {
            // ignore
          }
        };

        // First: look for a PENDING job ready to run
        const pendingIndex = store.index("queue_status_visible_at");
        const pendingRequest = pendingIndex.openCursor(
          IDBKeyRange.bound(
            [...prefixKeyValues, this.queueName, JobStatus.PENDING, ""],
            [...prefixKeyValues, this.queueName, JobStatus.PENDING, now],
            false,
            false
          )
        );

        pendingRequest.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) {
            // No PENDING job found — try expired-lease PROCESSING job
            if (!claimedJob) {
              tryExpiredLeaseScan();
            }
            return;
          }
          const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
          if (
            job.queue !== this.queueName ||
            job.status !== JobStatus.PENDING ||
            !this.matchesPrefixes(job)
          ) {
            cursor.continue();
            return;
          }
          tryClaimJob(job);
          // Don't continue cursor — we attempted a claim
        };

        pendingRequest.onerror = () => reject(pendingRequest.error);

        const tryExpiredLeaseScan = () => {
          // Scan PROCESSING jobs to find one with an expired lease
          const processingIndex = store.index("queue_status_visible_at");
          const processingRequest = processingIndex.openCursor(
            IDBKeyRange.bound(
              [...prefixKeyValues, this.queueName, JobStatus.PROCESSING, ""],
              [...prefixKeyValues, this.queueName, JobStatus.PROCESSING, "￿"],
              false,
              false
            )
          );

          processingRequest.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor) return; // none found, tx.oncomplete will resolve with undefined
            const job = cursor.value as JobStorageFormat<Input, Output> & Record<string, unknown>;
            if (
              job.queue !== this.queueName ||
              job.status !== JobStatus.PROCESSING ||
              !this.matchesPrefixes(job)
            ) {
              cursor.continue();
              return;
            }
            // Check for expired lease (null = expired per spec)
            if (job.lease_expires_at && job.lease_expires_at >= now) {
              cursor.continue();
              return;
            }
            tryClaimJob(job);
            // Don't continue — attempted a claim
          };

          processingRequest.onerror = () => reject(processingRequest.error);
        };

        // Wait for transaction to complete before resolving
        tx.oncomplete = () => {
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
    const verifiedJob = await this.get(jobToReturn.id);

    if (!verifiedJob) {
      return undefined;
    }

    if (verifiedJob.lease_owner !== claimToken) {
      return undefined;
    }

    if (verifiedJob.status !== JobStatus.PROCESSING) {
      return undefined;
    }

    return verifiedJob;
  }

  /**
   * Extend the lease on a currently PROCESSING job.
   * @param id - The ID of the job to extend the lease for
   * @param workerId - Worker ID that must match the current lease owner (lease_owner)
   * @param ms - Number of milliseconds to extend the lease by
   */
  public async extendLease(id: unknown, workerId: string, ms: number): Promise<void> {
    const job = await this.get(id);
    if (!job || job.status !== JobStatus.PROCESSING || job.lease_owner !== workerId) {
      throw new Error(
        `extendLease failed: job ${String(id)} is not PROCESSING or lease is not owned by worker ${workerId}`
      );
    }
    job.lease_expires_at = new Date(Date.now() + ms).toISOString();
    await this.put(job);
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
        const currentAttempts = existing.attempts ?? 0;
        job.attempts = currentAttempts + 1;
        // PENDING-retry / terminal completion: always clear
        // abort_requested_at so a flag set DURING the attempt does not
        // survive into the next retry and immediately cancel it.
        const jobAsRecord = job as JobStorageFormat<Input, Output> & Record<string, unknown>;
        jobAsRecord.abort_requested_at = null;
        // Ensure queue is set correctly
        job.queue = this.queueName;

        // Ensure prefix values are preserved
        const jobWithPrefixes = jobAsRecord;
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
  public async releaseClaim(id: unknown): Promise<void> {
    const job = await this.get(id);
    if (!job) return;

    job.status = JobStatus.PENDING;
    job.lease_owner = null;
    job.progress = 0;
    job.progress_message = "";
    job.progress_details = null;
    // Clear stale abort_requested_at — an abort flag set during the previous
    // claim must not immediately cancel the next worker that picks up the row.
    (job as unknown as Record<string, unknown>).abort_requested_at = null;

    await this.put(job);
  }

  /**
   * Aborts a job.
   * - If PENDING: immediately mark as FAILED with abort_requested_at set.
   * - If PROCESSING: set abort_requested_at only (leave status as PROCESSING).
   * - Otherwise: no-op.
   */
  public async abort(id: unknown): Promise<void> {
    const job = await this.get(id);
    if (!job) return;
    const now = new Date().toISOString();
    if (job.status === JobStatus.PENDING) {
      job.status = JobStatus.FAILED;
      job.abort_requested_at = now;
      job.completed_at = now;
      // Use put() (not complete()) so attempts is NOT bumped — the worker
      // never actually attempted this job. Matches the cross-backend
      // contract verified in InMemory/Postgres.
      await this.put(job);
    } else if (job.status === JobStatus.PROCESSING) {
      job.abort_requested_at = now;
      await this.put(job);
    }
  }

  /** Force-overwrite status without touching attempts (used to persist DISABLED after lease release). */
  public async saveStatus(id: unknown, status: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.tableName, "readwrite");
    const store = tx.objectStore(this.tableName);
    const getRequest = store.get(id as IDBValidKey);
    return new Promise((resolve, reject) => {
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          resolve();
          return;
        }
        const putRequest = store.put({ ...record, status });
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
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
   * Terminal write that does NOT bump `attempts`. See IQueueStorage.finalize
   * for the rationale (avoids double-counting on ack/fail).
   */
  public async finalize(
    id: unknown,
    fields: {
      output?: Output | null;
      error?: string | null;
      error_code?: string | null;
      status?: JobStatus;
      completed_at?: string | null;
      abort_requested_at?: string | null;
      lease_owner?: string | null;
      progress?: number;
      progress_message?: string;
      progress_details?: Record<string, any> | null;
    }
  ): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    const updated = existing as JobStorageFormat<Input, Output> & Record<string, unknown>;
    if ("output" in fields) updated.output = fields.output ?? null;
    if ("error" in fields) updated.error = fields.error ?? null;
    if ("error_code" in fields) updated.error_code = fields.error_code ?? null;
    if ("status" in fields) updated.status = fields.status;
    if ("completed_at" in fields) updated.completed_at = fields.completed_at ?? null;
    if ("abort_requested_at" in fields) {
      updated.abort_requested_at = fields.abort_requested_at ?? null;
    }
    if ("lease_owner" in fields) updated.lease_owner = fields.lease_owner ?? null;
    if ("progress" in fields) updated.progress = fields.progress ?? 0;
    if ("progress_message" in fields) updated.progress_message = fields.progress_message ?? "";
    if ("progress_details" in fields) updated.progress_details = fields.progress_details ?? null;
    await this.put(updated);
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
   * Persists a job to the store without modifying attempts or other completion logic.
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

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  EventEmitter,
  getLogger,
  makeFingerprint,
  sleep,
  uuid4,
} from "@workglow/util";
import {
  IQueueStorage,
  JobStatus,
  JobStorageFormat,
  QueueChangePayload,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "./IQueueStorage";

/**
 * Event listeners for queue storage events
 */
type QueueEventListeners<Input, Output> = {
  change: (payload: QueueChangePayload<Input, Output>) => void;
};

export const IN_MEMORY_QUEUE_STORAGE = createServiceToken<IQueueStorage<any, any>>(
  "jobqueue.storage.inMemory"
);

/**
 * In-memory implementation of a job queue that manages asynchronous tasks.
 * Supports job scheduling, status tracking, result caching, and prefix-based filtering.
 */
export class InMemoryQueueStorage<Input, Output> implements IQueueStorage<Input, Output> {
  public readonly scope = "process" as const;
  /** The prefix values for filtering jobs */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** Event emitter for change notifications */
  protected readonly events = new EventEmitter<QueueEventListeners<Input, Output>>();

  /**
   * Creates a new in-memory job queue
   * @param queueName - Name of the queue
   * @param options - Optional configuration including prefix filters
   */
  constructor(
    public readonly queueName: string,
    options?: QueueStorageOptions
  ) {
    this.jobQueue = [];
    this.prefixValues = options?.prefixValues ?? {};
  }

  /** Internal array storing all jobs */
  public jobQueue: Array<JobStorageFormat<Input, Output> & Record<string, unknown>>;

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
   * Adds a new job to the queue
   * Generates an ID and fingerprint if not provided
   */
  public async add(job: JobStorageFormat<Input, Output>): Promise<unknown> {
    await sleep(0);
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

    this.jobQueue.push(jobWithPrefixes);
    this.events.emit("change", { type: "INSERT", new: jobWithPrefixes });
    return jobWithPrefixes.id;
  }

  /**
   * Retrieves a job from the queue by its id.
   * @param id - The id of the job to retrieve.
   * @returns A promise that resolves to the job or undefined if the job is not found.
   */
  public async get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> {
    await sleep(0);
    const job = this.jobQueue.find((j) => j.id === id);
    if (job && this.matchesPrefixes(job)) {
      return job;
    }
    return undefined;
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
  ): Promise<Array<JobStorageFormat<Input, Output>>> {
    await sleep(0);
    num = Number(num) || 100;
    return this.jobQueue
      .filter((j) => this.matchesPrefixes(j))
      .sort((a, b) => (a.visible_at || "").localeCompare(b.visible_at || ""))
      .filter((j) => j.status === status)
      .slice(0, num);
  }

  /**
   * Retrieves the next available job that is ready to be processed.
   * Claims PENDING jobs ready to run, and also reclaims PROCESSING jobs whose
   * lease has expired (crash recovery). Sets lease_expires_at on the claimed row.
   * @param workerId - Worker ID to associate with the job
   * @param opts - Optional options including leaseMs (default 30000)
   * @returns The next job or undefined if no job is available
   */
  public async next(
    workerId: string,
    opts?: { leaseMs?: number }
  ): Promise<JobStorageFormat<Input, Output> | undefined> {
    await sleep(0);
    const leaseMs = opts?.leaseMs ?? 30000;
    const now = new Date().toISOString();
    const leaseExpiry = new Date(Date.now() + leaseMs).toISOString();

    // First look for a normal PENDING job ready to run
    const pending = this.jobQueue
      .filter((job) => this.matchesPrefixes(job))
      .filter((job) => job.status === JobStatus.PENDING)
      .filter((job) => !job.visible_at || job.visible_at <= now)
      .sort((a, b) => (a.visible_at || "").localeCompare(b.visible_at || ""));

    // Also look for PROCESSING jobs with expired leases
    const expiredLease = this.jobQueue
      .filter((job) => this.matchesPrefixes(job))
      .filter((job) => job.status === JobStatus.PROCESSING)
      .filter((job) => !job.lease_expires_at || job.lease_expires_at < now)
      .sort((a, b) => (a.visible_at || "").localeCompare(b.visible_at || ""));

    const job = pending[0] ?? expiredLease[0];
    if (job) {
      const oldJob = { ...job };
      job.status = JobStatus.PROCESSING;
      job.last_attempted_at = now;
      job.lease_owner = workerId;
      job.lease_expires_at = leaseExpiry;
      this.events.emit("change", { type: "UPDATE", old: oldJob, new: job });
      return job;
    }
  }

  /**
   * Extend the lease on a currently PROCESSING job.
   * @param id - The ID of the job to extend the lease for
   * @param workerId - Worker ID that must match the current lease owner (lease_owner)
   * @param ms - Number of milliseconds to extend the lease by
   */
  public async extendLease(id: unknown, workerId: string, ms: number): Promise<void> {
    await sleep(0);
    const job = this.jobQueue.find((j) => j.id === id && this.matchesPrefixes(j));
    if (!job || job.status !== JobStatus.PROCESSING || job.lease_owner !== workerId) {
      throw new Error(
        `extendLease failed: job ${String(id)} is not PROCESSING or lease is not owned by worker ${workerId}`
      );
    }
    const oldJob = { ...job };
    job.lease_expires_at = new Date(Date.now() + ms).toISOString();
    this.events.emit("change", { type: "UPDATE", old: oldJob, new: job });
  }

  /**
   * Retrieves the size of the queue for a given status
   * @param status - The status of the jobs to retrieve.
   * @returns A promise that resolves to the number of jobs.
   */
  public async size(status: JobStatus = JobStatus.PENDING): Promise<number> {
    await sleep(0);
    return this.jobQueue.filter((j) => this.matchesPrefixes(j) && j.status === status).length;
  }

  /**
   * Saves the progress of a job
   * @param jobId - The id of the job to save the progress for.
   * @param progress - The progress of the job.
   * @param message - The message of the job.
   * @param details - The details of the job.
   */
  public async saveProgress(
    id: unknown,
    progress: number,
    message: string,
    details: Record<string, any> | null
  ): Promise<void> {
    await sleep(0);
    const job = this.jobQueue.find((j) => j.id === id && this.matchesPrefixes(j));
    if (!job) {
      // Job not found - this can happen if the job was already completed/removed
      // or if there's a race condition. Silently ignore progress updates for missing jobs.
      const jobWithAnyPrefix = this.jobQueue.find((j) => j.id === id);
      getLogger().warn("Job not found for progress update", {
        id,
        reason: jobWithAnyPrefix ? "prefix_mismatch" : "missing",
        existingStatus: jobWithAnyPrefix?.status,
        queueName: this.queueName,
        prefixValues: this.prefixValues,
      });
      return;
    }

    // Skip progress updates for jobs that are already completed or failed
    // to avoid unnecessary updates and potential race conditions
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      getLogger().warn("Job already completed or failed for progress update", {
        id,
        status: job.status,
        completedAt: job.completed_at,
        error: job.error,
      });
      return;
    }

    const oldJob = { ...job };
    job.progress = progress;
    job.progress_message = message;
    job.progress_details = details;
    this.events.emit("change", { type: "UPDATE", old: oldJob, new: job });
  }

  /**
   * Marks a job as complete with its output or error
   * Handles attempts for failed jobs and triggers completion callbacks
   * @param id - ID of the job to complete
   * @param output - Result of the job execution
   * @param error - Optional error message if job failed
   */
  public async complete(job: JobStorageFormat<Input, Output>) {
    await sleep(0);
    const jobWithPrefixes = job as JobStorageFormat<Input, Output> & Record<string, unknown>;
    const index = this.jobQueue.findIndex((j) => j.id === job.id && this.matchesPrefixes(j));
    if (index !== -1) {
      const existing = this.jobQueue[index];
      const currentAttempts = existing?.attempts ?? 0;
      jobWithPrefixes.attempts = currentAttempts + 1;
      // Preserve prefix values from the existing job
      for (const [key, value] of Object.entries(this.prefixValues)) {
        jobWithPrefixes[key] = value;
      }
      this.jobQueue[index] = jobWithPrefixes;
      this.events.emit("change", { type: "UPDATE", old: existing, new: jobWithPrefixes });
    }
  }

  /**
   * Releases a claimed job back to PENDING without incrementing attempts.
   * @param id - The id of the claimed job to release.
   */
  public async releaseClaim(id: unknown): Promise<void> {
    await sleep(0);
    const job = this.jobQueue.find((j) => j.id === id && this.matchesPrefixes(j));
    if (job) {
      const oldJob = { ...job };
      job.status = JobStatus.PENDING;
      job.lease_owner = null;
      job.progress = 0;
      job.progress_message = "";
      job.progress_details = null;
      this.events.emit("change", { type: "UPDATE", old: oldJob, new: job });
    }
  }

  /**
   * Aborts a job.
   * - If PENDING: immediately mark as FAILED with abort_requested_at set.
   * - If PROCESSING: set abort_requested_at only (leave status as PROCESSING).
   * - Otherwise: no-op.
   * @param id - The id of the job to abort.
   */
  public async abort(id: unknown): Promise<void> {
    await sleep(0);
    const job = this.jobQueue.find((j) => j.id === id && this.matchesPrefixes(j));
    if (!job) return;
    const oldJob = { ...job };
    const now = new Date().toISOString();
    if (job.status === JobStatus.PENDING) {
      job.status = JobStatus.FAILED;
      job.abort_requested_at = now;
      job.completed_at = now;
    } else if (job.status === JobStatus.PROCESSING) {
      job.abort_requested_at = now;
    } else {
      return;
    }
    this.events.emit("change", { type: "UPDATE", old: oldJob, new: job });
  }

  /**
   * Retrieves all jobs by their job_run_id.
   * @param job_run_id - The job_run_id of the jobs to retrieve.
   * @returns A promise that resolves to an array of jobs.
   */
  public async getByRunId(runId: string): Promise<Array<JobStorageFormat<Input, Output>>> {
    await sleep(0);
    return this.jobQueue.filter((job) => this.matchesPrefixes(job) && job.job_run_id === runId);
  }

  /**
   * Deletes all jobs from the queue that match the current prefix values.
   */
  public async deleteAll(): Promise<void> {
    await sleep(0);
    const deletedJobs = this.jobQueue.filter((job) => this.matchesPrefixes(job));
    this.jobQueue = this.jobQueue.filter((job) => !this.matchesPrefixes(job));
    for (const job of deletedJobs) {
      this.events.emit("change", { type: "DELETE", old: job });
    }
  }

  /**
   * Looks up cached output for a given input
   * Uses input fingerprinting for efficient matching
   * @param input - The input to look up the cached output for.
   * @returns The cached output or null if not found
   */
  public async outputForInput(input: Input): Promise<Output | null> {
    await sleep(0);
    const fingerprint = await makeFingerprint(input);
    return (
      this.jobQueue.find(
        (j) =>
          this.matchesPrefixes(j) &&
          j.fingerprint === fingerprint &&
          j.status === JobStatus.COMPLETED
      )?.output ?? null
    );
  }

  /**
   * Deletes a job by its ID
   */
  public async delete(id: unknown): Promise<void> {
    await sleep(0);
    const deletedJob = this.jobQueue.find((job) => job.id === id && this.matchesPrefixes(job));
    this.jobQueue = this.jobQueue.filter((job) => !(job.id === id && this.matchesPrefixes(job)));
    if (deletedJob) {
      this.events.emit("change", { type: "DELETE", old: deletedJob });
    }
  }

  /**
   * Delete jobs with a specific status older than a cutoff date
   * @param status - Status of jobs to delete
   * @param olderThanMs - Delete jobs completed more than this many milliseconds ago
   */
  public async deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    await sleep(0);
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();
    const deletedJobs = this.jobQueue.filter(
      (job) =>
        this.matchesPrefixes(job) &&
        job.status === status &&
        job.completed_at &&
        job.completed_at <= cutoffDate
    );
    this.jobQueue = this.jobQueue.filter(
      (job) =>
        !this.matchesPrefixes(job) ||
        job.status !== status ||
        !job.completed_at ||
        job.completed_at > cutoffDate
    );
    for (const job of deletedJobs) {
      this.events.emit("change", { type: "DELETE", old: job });
    }
  }

  /**
   * No-op — in-memory storage has no schema to migrate.
   */
  public async migrate(): Promise<void> {
    // intentional no-op
  }

  /** No versioned schema for in-memory storage. */
  public getMigrations(): ReadonlyArray<unknown> {
    return [];
  }

  /**
   * Checks if a job matches the specified prefix filter
   * @param job - The job to check
   * @param prefixFilter - The prefix filter (undefined = use instance prefixes, {} = no filter)
   */
  private matchesPrefixFilter(
    job: JobStorageFormat<Input, Output>,
    prefixFilter?: Readonly<Record<string, string | number>>
  ): boolean {
    // If prefixFilter is explicitly an empty object, no prefix filtering
    if (prefixFilter && Object.keys(prefixFilter).length === 0) {
      return true;
    }

    // Use provided prefixFilter or fall back to instance's prefixValues
    const filterValues = prefixFilter ?? this.prefixValues;

    // If no filter values, match all
    if (Object.keys(filterValues).length === 0) {
      return true;
    }

    // Check each filter value
    const jobWithPrefixes = job as JobStorageFormat<Input, Output> & Record<string, unknown>;
    for (const [key, value] of Object.entries(filterValues)) {
      if (jobWithPrefixes[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Subscribes to changes in the queue.
   * Since InMemory is both client and server, changes are detected via local events.
   *
   * @param callback - Function called when a change occurs
   * @param options - Subscription options including prefix filter
   * @returns Unsubscribe function
   */
  public subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    const prefixFilter = options?.prefixFilter;

    // Create a filtered callback wrapper
    const filteredCallback = (change: QueueChangePayload<Input, Output>) => {
      // Check if either old or new job matches the filter
      const newMatches = change.new ? this.matchesPrefixFilter(change.new, prefixFilter) : false;
      const oldMatches = change.old ? this.matchesPrefixFilter(change.old, prefixFilter) : false;

      if (!newMatches && !oldMatches) {
        return;
      }

      callback(change);
    };

    return this.events.subscribe("change", filteredCallback);
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type {
  IQueueStorage,
  JobStorageFormat,
  PrefixColumn,
  QueueChangePayload,
  QueueChangeType,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "@workglow/job-queue";
import { JobStatus } from "@workglow/job-queue";
import { PollingSubscriptionManager } from "@workglow/storage";
import { createServiceToken, deepEqual, makeFingerprint, uuid4 } from "@workglow/util";

export const SUPABASE_QUEUE_STORAGE = createServiceToken<IQueueStorage<any, any>>(
  "jobqueue.storage.supabase"
);

/**
 * Supabase implementation of a job queue.
 * Provides storage and retrieval for job execution states using Supabase.
 */
export class SupabaseQueueStorage<Input, Output> implements IQueueStorage<Input, Output> {
  public readonly scope = "cluster" as const;
  protected readonly client: SupabaseClient;
  protected readonly prefixes: readonly PrefixColumn[];
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  protected readonly tableName: string;
  private realtimeChannel: RealtimeChannel | null = null;
  private pollingManager: PollingSubscriptionManager<
    JobStorageFormat<Input, Output>,
    unknown,
    QueueChangePayload<Input, Output>
  > | null = null;

  constructor(
    client: SupabaseClient,
    protected readonly queueName: string,
    options?: QueueStorageOptions
  ) {
    this.client = client as SupabaseClient;
    this.prefixes = options?.prefixes ?? [];
    this.prefixValues = options?.prefixValues ?? {};
    // Generate table name based on prefix configuration to avoid column conflicts
    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.tableName = `job_queue_${prefixNames}`;
    } else {
      this.tableName = "job_queue";
    }
  }

  /**
   * Gets the SQL column type for a prefix column (Supabase supports UUID natively)
   */
  private getPrefixColumnType(type: PrefixColumn["type"]): string {
    return type === "uuid" ? "UUID" : "INTEGER";
  }

  /**
   * Builds the prefix columns SQL for CREATE TABLE
   */
  private buildPrefixColumnsSql(): string {
    if (this.prefixes.length === 0) return "";
    return (
      this.prefixes
        .map((p) => `${p.name} ${this.getPrefixColumnType(p.type)} NOT NULL`)
        .join(",\n      ") + ",\n      "
    );
  }

  /**
   * Builds prefix column names for use in queries
   */
  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  /**
   * Applies prefix filters to a Supabase query builder
   */
  private applyPrefixFilters<T>(query: T): T {
    let result = query as any;
    for (const prefix of this.prefixes) {
      result = result.eq(prefix.name, this.prefixValues[prefix.name]);
    }
    return result as T;
  }

  /**
   * Gets prefix values as an object for inserts
   */
  private getPrefixInsertValues(): Record<string, string | number> {
    const values: Record<string, string | number> = {};
    for (const prefix of this.prefixes) {
      values[prefix.name] = this.prefixValues[prefix.name];
    }
    return values;
  }

  /**
   * Builds WHERE clause conditions for prefix filtering with inline values (for raw SQL)
   * @returns SQL conditions string with values inlined
   */
  private buildPrefixWhereSql(): string {
    if (this.prefixes.length === 0) {
      return "";
    }
    const conditions = this.prefixes
      .map((p) => {
        const value = this.prefixValues[p.name];
        if (p.type === "uuid") {
          const validated = this.validateSqlValue(String(value), `prefix "${p.name}"`);
          return `${p.name} = '${this.escapeSqlString(validated)}'`;
        }
        const numValue = Number(value ?? 0);
        if (!Number.isFinite(numValue)) {
          throw new Error(`Invalid numeric prefix value for "${p.name}": ${value}`);
        }
        return `${p.name} = ${numValue}`;
      })
      .join(" AND ");
    return " AND " + conditions;
  }

  /**
   * Regex for validating SQL literal-safe strings.
   * Used for quoted values (e.g. queue names/IDs) and only allows alphanumeric
   * characters, underscores, hyphens, colons, and periods.
   */
  private static readonly SAFE_SQL_VALUE_RE = /^[a-zA-Z0-9_\-.:]+$/;

  /**
   * Validates that a string value is safe for use as a quoted SQL literal.
   * Throws an error if the value contains characters outside SAFE_SQL_VALUE_RE.
   */
  private validateSqlValue(value: string, context: string): string {
    if (!SupabaseQueueStorage.SAFE_SQL_VALUE_RE.test(value)) {
      throw new Error(
        `Unsafe value for ${context}: "${value}". Values must match /^[a-zA-Z0-9_\\-.:]+$/.`
      );
    }
    return value;
  }

  /**
   * Escapes a string value for use in SQL
   */
  private escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Schema setup for Supabase queues.
   *
   * Supabase exposes the SQL surface via a side-installed `exec_sql` RPC
   * rather than the `pg.Pool` shape the {@link PostgresMigrationRunner} is
   * built against, so this storage doesn't share the runner's bookkeeping
   * table — it runs idempotent CREATE-IF-NOT-EXISTS statements directly via
   * the RPC. {@link getMigrations} returns an empty array for the same
   * reason.
   */
  public async migrate(): Promise<void> {
    // Note: For Supabase, table creation should typically be done through migrations
    // This setup assumes the table already exists or uses exec_sql RPC function.
    // ABORTING is included in the enum for backward compatibility with existing data,
    // but the application no longer writes that value.
    const enumValues = [...Object.values(JobStatus), "ABORTING"]
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((v) => `'${v}'`)
      .join(",");
    const createTypeSql = `CREATE TYPE job_status AS ENUM (${enumValues})`;

    const { error: typeError } = await this.client.rpc("exec_sql", { query: createTypeSql });
    // Ignore error if type already exists (code 42710)
    if (typeError && typeError.code !== "42710") {
      throw typeError;
    }

    const prefixColumnsSql = this.buildPrefixColumnsSql();
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixIndexPrefix =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const indexSuffix = prefixColumnNames.length > 0 ? "_" + prefixColumnNames.join("_") : "";

    const createTableSql = `
    CREATE TABLE IF NOT EXISTS ${this.tableName} (
      id SERIAL NOT NULL,
      ${prefixColumnsSql}fingerprint text NOT NULL,
      queue text NOT NULL,
      job_run_id text NOT NULL,
      status job_status NOT NULL default 'PENDING',
      input jsonb NOT NULL,
      output jsonb,
      run_attempts integer default 0,
      max_retries integer default 20,
      run_after timestamp with time zone DEFAULT now(),
      last_ran_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT now(),
      deadline_at timestamp with time zone,
      completed_at timestamp with time zone,
      error text,
      error_code text,
      progress real DEFAULT 0,
      progress_message text DEFAULT '',
      progress_details jsonb,
      worker_id text,
      abort_requested_at timestamp with time zone,
      lease_expires_at timestamp with time zone
    )`;

    const { error: tableError } = await this.client.rpc("exec_sql", { query: createTableSql });
    if (tableError) {
      // Ignore error if table already exists (code 42P07)
      if (tableError.code !== "42P07") {
        throw tableError;
      }
    }

    // Add new columns to existing tables (idempotent via IF NOT EXISTS workaround)
    const alterSqls = [
      `ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS abort_requested_at timestamp with time zone`,
      `ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone`,
    ];
    for (const sql of alterSqls) {
      const { error } = await this.client.rpc("exec_sql", { query: sql });
      // Ignore errors (column may already exist)
      if (error && error.code !== "42701") {
        // 42701 = duplicate_column
        // ignore
      }
    }

    // Create indexes with prefix columns prepended
    const indexes = [
      `CREATE INDEX IF NOT EXISTS job_fetcher${indexSuffix}_idx ON ${this.tableName} (${prefixIndexPrefix}id, status, run_after)`,
      `CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx ON ${this.tableName} (${prefixIndexPrefix}queue, status, run_after)`,
      `CREATE INDEX IF NOT EXISTS jobs_fingerprint${indexSuffix}_unique_idx ON ${this.tableName} (${prefixIndexPrefix}queue, fingerprint, status)`,
    ];

    for (const indexSql of indexes) {
      await this.client.rpc("exec_sql", { query: indexSql });
      // Ignore index creation errors
    }
  }

  /** Supabase queue runs DDL via `exec_sql`, not via the migration runner. */
  public getMigrations(): ReadonlyArray<unknown> {
    return [];
  }

  /**
   * Adds a new job to the queue.
   * @param job - The job to add
   * @returns The ID of the added job
   */
  public async add(job: JobStorageFormat<Input, Output>): Promise<unknown> {
    const now = new Date().toISOString();
    job.queue = this.queueName;
    job.job_run_id = job.job_run_id ?? uuid4();
    job.fingerprint = await makeFingerprint(job.input);
    job.status = JobStatus.PENDING;
    job.progress = 0;
    job.progress_message = "";
    job.progress_details = null;
    job.created_at = now;
    job.run_after = now;

    const prefixInsertValues = this.getPrefixInsertValues();

    const { data, error } = await this.client
      .from(this.tableName)
      .insert({
        ...prefixInsertValues,
        queue: job.queue,
        fingerprint: job.fingerprint,
        input: job.input,
        run_after: job.run_after,
        created_at: job.created_at,
        deadline_at: job.deadline_at,
        max_retries: job.max_retries,
        job_run_id: job.job_run_id,
        progress: job.progress,
        progress_message: job.progress_message,
        progress_details: job.progress_details,
      })
      .select("id")
      .single();

    if (error) throw error;
    if (!data) throw new Error("Failed to add to queue");

    job.id = data.id;
    return job.id;
  }

  /**
   * Retrieves a job by its ID.
   * @param id - The ID of the job to retrieve
   * @returns The job if found, undefined otherwise
   */
  public async get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> {
    let query = this.client
      .from(this.tableName)
      .select("*")
      .eq("id", id)
      .eq("queue", this.queueName);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return undefined; // Not found
      throw error;
    }

    return data as JobStorageFormat<Input, Output> | undefined;
  }

  /**
   * Retrieves a slice of jobs from the queue.
   * @param status - The status to filter by
   * @param num - Maximum number of jobs to return
   * @returns An array of jobs
   */
  public async peek(
    status: JobStatus = JobStatus.PENDING,
    num: number = 100
  ): Promise<JobStorageFormat<Input, Output>[]> {
    num = Number(num) || 100;

    let query = this.client
      .from(this.tableName)
      .select("*")
      .eq("queue", this.queueName)
      .eq("status", status);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query.order("run_after", { ascending: true }).limit(num);

    if (error) throw error;
    return (data as JobStorageFormat<Input, Output>[]) ?? [];
  }

  /**
   * Retrieves the next available job that is ready to be processed.
   * Claims PENDING jobs ready to run, and also reclaims PROCESSING jobs whose
   * lease has expired (crash recovery). Sets lease_expires_at on the claimed row.
   * @param workerId - Worker ID to associate with the job (required)
   * @param opts - Optional options including leaseMs (default 30000)
   * @returns The next job or undefined if no job is available
   */
  public async next(
    workerId: string,
    opts?: { leaseMs?: number }
  ): Promise<JobStorageFormat<Input, Output> | undefined> {
    const leaseMs = opts?.leaseMs ?? 30000;
    const prefixConditions = this.buildPrefixWhereSql();
    const validatedQueueName = this.validateSqlValue(this.queueName, "queueName");
    const validatedWorkerId = this.validateSqlValue(workerId, "workerId");
    const escapedQueueName = this.escapeSqlString(validatedQueueName);
    const escapedWorkerId = this.escapeSqlString(validatedWorkerId);

    const sql = `
      UPDATE ${this.tableName}
      SET status = '${JobStatus.PROCESSING}',
          last_ran_at = NOW() AT TIME ZONE 'UTC',
          worker_id = '${escapedWorkerId}',
          lease_expires_at = NOW() AT TIME ZONE 'UTC' + (${Number(leaseMs)} * INTERVAL '1 millisecond')
      WHERE id = (
        SELECT id
        FROM ${this.tableName}
        WHERE queue = '${escapedQueueName}'
        AND (
          (status = '${JobStatus.PENDING}' AND run_after <= NOW() AT TIME ZONE 'UTC')
          OR (status = '${JobStatus.PROCESSING}' AND (lease_expires_at IS NULL OR lease_expires_at < NOW() AT TIME ZONE 'UTC'))
        )
        ${prefixConditions}
        ORDER BY run_after ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *`;

    const { data, error } = await this.client.rpc("exec_sql", { query: sql });

    if (error) throw error;

    // exec_sql returns result rows as an array
    if (!data || !Array.isArray(data) || data.length === 0) {
      return undefined;
    }

    return data[0] as JobStorageFormat<Input, Output>;
  }

  /**
   * Extend the lease on a currently PROCESSING job.
   * @param id - The ID of the job to extend the lease for
   * @param workerId - Worker ID that must match the current lease owner (worker_id)
   * @param ms - Number of milliseconds to extend the lease by
   */
  public async extendLease(id: unknown, workerId: string, ms: number): Promise<void> {
    const validatedWorkerId = this.validateSqlValue(workerId, "workerId");
    const escapedWorkerId = this.escapeSqlString(validatedWorkerId);
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      throw new Error(`Invalid job id: ${id}`);
    }

    const prefixConditions = this.buildPrefixWhereSql();

    const sql = `
      UPDATE ${this.tableName}
        SET lease_expires_at = NOW() AT TIME ZONE 'UTC' + (${Number(ms)} * INTERVAL '1 millisecond')
        WHERE id = ${numericId}
          AND queue = '${this.escapeSqlString(this.validateSqlValue(this.queueName, "queueName"))}'
          AND worker_id = '${escapedWorkerId}'
          AND status = '${JobStatus.PROCESSING}'
          ${prefixConditions}`;

    const { data, error } = await this.client.rpc("exec_sql", { query: sql });
    if (error) throw error;

    // exec_sql returns affected rows; if empty, the lease was lost
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error(
        `extendLease failed: job ${String(id)} is not PROCESSING or lease is not owned by worker ${workerId}`
      );
    }
  }

  /**
   * Retrieves the number of jobs in the queue with a specific status.
   * @param status - The status of the jobs to count
   * @returns The count of jobs with the specified status
   */
  public async size(status = JobStatus.PENDING): Promise<number> {
    let query = this.client
      .from(this.tableName)
      .select("*", { count: "exact", head: true })
      .eq("queue", this.queueName)
      .eq("status", status);

    query = this.applyPrefixFilters(query);

    const { count, error } = await query;

    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Gets all jobs from the queue that match the current prefix values.
   * Used internally for polling-based subscriptions.
   *
   * @returns An array of jobs
   */
  private async getAllJobs(): Promise<Array<JobStorageFormat<Input, Output>>> {
    let query = this.client.from(this.tableName).select("*").eq("queue", this.queueName);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query;

    if (error) throw error;
    return (data ?? []) as Array<JobStorageFormat<Input, Output>>;
  }

  /**
   * Marks a job as complete with its output or error.
   * Enhanced error handling:
   * - For a retryable error, increments run_attempts and updates run_after.
   * - Marks a job as FAILED immediately for permanent or generic errors.
   */
  public async complete(jobDetails: JobStorageFormat<Input, Output>): Promise<void> {
    const now = new Date().toISOString();

    // Handle disabled without changing attempts
    if (jobDetails.status === JobStatus.DISABLED) {
      let query = this.client
        .from(this.tableName)
        .update({
          status: jobDetails.status,
          progress: 100,
          progress_message: "",
          progress_details: null,
          completed_at: now,
          last_ran_at: now,
        })
        .eq("id", jobDetails.id)
        .eq("queue", this.queueName);
      query = this.applyPrefixFilters(query);
      const { error } = await query;
      if (error) throw error;
      return;
    }

    // Read current attempts to compute next value deterministically
    let getQuery = this.client
      .from(this.tableName)
      .select("run_attempts, max_retries")
      .eq("id", jobDetails.id as number)
      .eq("queue", this.queueName);
    getQuery = this.applyPrefixFilters(getQuery);
    const { data: current, error: getError } = await getQuery.single();
    if (getError) throw getError;
    const currentAttempts = (current?.run_attempts as number | undefined) ?? 0;
    const maxRetries = (current?.max_retries as number | undefined) ?? jobDetails.max_retries ?? 10;
    const nextAttempts = currentAttempts + 1;

    if (jobDetails.status === JobStatus.PENDING) {
      // Check if the next attempt would exceed max retries
      if (nextAttempts > maxRetries) {
        // Update to FAILED status instead of rescheduling
        let failQuery = this.client
          .from(this.tableName)
          .update({
            status: JobStatus.FAILED,
            error: "Max retries reached",
            error_code: "MAX_RETRIES_REACHED",
            progress: 100,
            progress_message: "",
            progress_details: null,
            completed_at: now,
            last_ran_at: now,
          })
          .eq("id", jobDetails.id)
          .eq("queue", this.queueName);
        failQuery = this.applyPrefixFilters(failQuery);
        const { error: failError } = await failQuery;
        if (failError) throw failError;
        return;
      }

      // Reschedule the job
      let query = this.client
        .from(this.tableName)
        .update({
          error: jobDetails.error ?? null,
          error_code: jobDetails.error_code ?? null,
          status: jobDetails.status,
          run_after: jobDetails.run_after!,
          progress: 0,
          progress_message: "",
          progress_details: null,
          run_attempts: nextAttempts,
          last_ran_at: now,
        })
        .eq("id", jobDetails.id)
        .eq("queue", this.queueName);
      query = this.applyPrefixFilters(query);
      const { error } = await query;
      if (error) throw error;
      return;
    }

    if (jobDetails.status === JobStatus.COMPLETED || jobDetails.status === JobStatus.FAILED) {
      let query = this.client
        .from(this.tableName)
        .update({
          output: jobDetails.output ?? null,
          error: jobDetails.error ?? null,
          error_code: jobDetails.error_code ?? null,
          status: jobDetails.status,
          progress: 100,
          progress_message: "",
          progress_details: null,
          run_attempts: nextAttempts,
          completed_at: now,
          last_ran_at: now,
        })
        .eq("id", jobDetails.id)
        .eq("queue", this.queueName);
      query = this.applyPrefixFilters(query);
      const { error } = await query;
      if (error) throw error;
      return;
    }

    // Transitional states (e.g. PROCESSING) — increment attempts like other stores
    let query = this.client
      .from(this.tableName)
      .update({
        status: jobDetails.status,
        output: jobDetails.output ?? null,
        error: jobDetails.error ?? null,
        error_code: jobDetails.error_code ?? null,
        run_after: jobDetails.run_after ?? null,
        run_attempts: nextAttempts,
        last_ran_at: now,
      })
      .eq("id", jobDetails.id)
      .eq("queue", this.queueName);
    query = this.applyPrefixFilters(query);
    const { error } = await query;
    if (error) throw error;
  }

  /**
   * Releases a claimed job without consuming a retry attempt.
   */
  public async releaseClaim(jobId: unknown): Promise<void> {
    let query = this.client
      .from(this.tableName)
      .update({
        status: JobStatus.PENDING,
        worker_id: null,
        progress: 0,
        progress_message: "",
        progress_details: null,
      })
      .eq("id", jobId)
      .eq("queue", this.queueName);

    query = this.applyPrefixFilters(query);
    const { error } = await query;
    if (error) throw error;
  }

  /**
   * Clears all jobs from the queue.
   */
  public async deleteAll(): Promise<void> {
    let query = this.client.from(this.tableName).delete().eq("queue", this.queueName);
    query = this.applyPrefixFilters(query);
    const { error } = await query;

    if (error) throw error;
  }

  /**
   * Looks up cached output for a given input
   * Uses input fingerprinting for efficient matching
   * @returns The cached output or null if not found
   */
  public async outputForInput(input: Input): Promise<Output | null> {
    const fingerprint = await makeFingerprint(input);

    let query = this.client
      .from(this.tableName)
      .select("output")
      .eq("fingerprint", fingerprint)
      .eq("queue", this.queueName)
      .eq("status", JobStatus.COMPLETED);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return data?.output ?? null;
  }

  /**
   * Aborts a job.
   * - If PENDING: immediately mark as FAILED with abort_requested_at set.
   * - If PROCESSING: set abort_requested_at only (leave status as PROCESSING).
   * - Otherwise: no-op.
   */
  public async abort(jobId: unknown): Promise<void> {
    const now = new Date().toISOString();

    // Abort PENDING → FAILED immediately
    {
      let query = this.client
        .from(this.tableName)
        .update({
          status: JobStatus.FAILED,
          abort_requested_at: now,
          completed_at: now,
        })
        .eq("id", jobId)
        .eq("queue", this.queueName)
        .eq("status", JobStatus.PENDING);
      query = this.applyPrefixFilters(query);
      const { error } = await query;
      if (error) throw error;
    }

    // Abort PROCESSING → set abort_requested_at only
    {
      let query = this.client
        .from(this.tableName)
        .update({ abort_requested_at: now })
        .eq("id", jobId)
        .eq("queue", this.queueName)
        .eq("status", JobStatus.PROCESSING);
      query = this.applyPrefixFilters(query);
      const { error } = await query;
      if (error) throw error;
    }
  }

  /**
   * Retrieves all jobs for a given job run ID.
   * @param job_run_id - The ID of the job run to retrieve
   * @returns An array of jobs
   */
  public async getByRunId(job_run_id: string): Promise<Array<JobStorageFormat<Input, Output>>> {
    let query = this.client
      .from(this.tableName)
      .select("*")
      .eq("job_run_id", job_run_id)
      .eq("queue", this.queueName);

    query = this.applyPrefixFilters(query);
    const { data, error } = await query;

    if (error) throw error;
    return (data as Array<JobStorageFormat<Input, Output>>) ?? [];
  }

  /**
   * Implements the saveProgress method
   */
  public async saveProgress(
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, any>
  ): Promise<void> {
    let query = this.client
      .from(this.tableName)
      .update({
        progress,
        progress_message: message,
        progress_details: details,
      })
      .eq("id", jobId)
      .eq("queue", this.queueName);

    query = this.applyPrefixFilters(query);
    const { error } = await query;

    if (error) throw error;
  }

  /**
   * Deletes a job by its ID
   */
  public async delete(jobId: unknown): Promise<void> {
    let query = this.client
      .from(this.tableName)
      .delete()
      .eq("id", jobId)
      .eq("queue", this.queueName);

    query = this.applyPrefixFilters(query);
    const { error } = await query;

    if (error) throw error;
  }

  /**
   * Delete jobs with a specific status older than a cutoff date
   * @param status - Status of jobs to delete
   * @param olderThanMs - Delete jobs completed more than this many milliseconds ago
   */
  public async deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();

    let query = this.client
      .from(this.tableName)
      .delete()
      .eq("queue", this.queueName)
      .eq("status", status)
      .not("completed_at", "is", null)
      .lte("completed_at", cutoffDate);

    query = this.applyPrefixFilters(query);
    const { error } = await query;

    if (error) throw error;
  }

  /**
   * Checks if a job from a realtime payload matches the specified prefix filter
   * @param job - The job record from the realtime payload
   * @param prefixFilter - The prefix filter to match against (undefined = use instance prefixes, {} = no filter)
   */
  private matchesPrefixFilter(
    job: Record<string, unknown> | undefined,
    prefixFilter?: Readonly<Record<string, string | number>>
  ): boolean {
    if (!job) return false;

    // Check queue name first
    if (job.queue !== this.queueName) {
      return false;
    }

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
    for (const [key, value] of Object.entries(filterValues)) {
      if (job[key] !== value) {
        return false;
      }
    }
    return true;
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
   * Gets all jobs from the queue with a custom prefix filter.
   * Used for subscriptions with custom prefix filters (filters at DB level).
   *
   * @param prefixFilter - The prefix values to filter by (empty object = all jobs)
   * @returns A promise that resolves to an array of jobs
   */
  private async getAllJobsWithFilter(
    prefixFilter: Readonly<Record<string, string | number>>
  ): Promise<Array<JobStorageFormat<Input, Output>>> {
    let query = this.client.from(this.tableName).select("*").eq("queue", this.queueName);

    // Apply the custom prefix filter
    for (const [key, value] of Object.entries(prefixFilter)) {
      query = query.eq(key, value);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data ?? []) as Array<JobStorageFormat<Input, Output>>;
  }

  /**
   * Subscribes to changes in the queue.
   * Uses Supabase realtime by default.
   *
   * @param callback - Function called when a change occurs
   * @param options - Subscription options including prefix filter
   * @returns Unsubscribe function
   */
  public subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    return this.subscribeToChangesWithRealtime(callback, options?.prefixFilter);
  }

  /**
   * Subscribe using Supabase realtime (protected).
   *
   * @param callback - Function called when a change occurs
   * @param prefixFilter - Optional prefix filter (undefined = use instance prefixes, {} = no filter)
   * @returns Unsubscribe function
   */
  protected subscribeToChangesWithRealtime(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    prefixFilter?: Readonly<Record<string, string | number>>
  ): () => void {
    const channelName = `queue-${this.tableName}-${this.queueName}-${Date.now()}`;

    this.realtimeChannel = this.client
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: this.tableName,
          filter: `queue=eq.${this.queueName}`,
        },
        (payload) => {
          // Filter by prefix values
          const newJob = payload.new as Record<string, unknown> | undefined;
          const oldJob = payload.old as Record<string, unknown> | undefined;

          // Check if either old or new job matches the filter
          const newMatches = this.matchesPrefixFilter(newJob, prefixFilter);
          const oldMatches = this.matchesPrefixFilter(oldJob, prefixFilter);

          if (!newMatches && !oldMatches) {
            return;
          }

          callback({
            type: payload.eventType.toUpperCase() as QueueChangeType,
            old:
              oldJob && Object.keys(oldJob).length > 0
                ? (oldJob as JobStorageFormat<Input, Output>)
                : undefined,
            new:
              newJob && Object.keys(newJob).length > 0
                ? (newJob as JobStorageFormat<Input, Output>)
                : undefined,
          });
        }
      )
      .subscribe();

    return () => {
      if (this.realtimeChannel) {
        this.client.removeChannel(this.realtimeChannel);
        this.realtimeChannel = null;
      }
    };
  }

  /**
   * Gets or creates the shared polling subscription manager for normal subscriptions (fallback).
   * This ensures all normal subscriptions share a single polling loop per interval.
   */
  private getPollingManager(): PollingSubscriptionManager<
    JobStorageFormat<Input, Output>,
    unknown,
    QueueChangePayload<Input, Output>
  > {
    if (!this.pollingManager) {
      this.pollingManager = new PollingSubscriptionManager<
        JobStorageFormat<Input, Output>,
        unknown,
        QueueChangePayload<Input, Output>
      >(
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
        }
      );
    }
    return this.pollingManager;
  }

  /**
   * Creates a dedicated polling subscription for custom prefix filters (fallback).
   * This runs separately from the normal polling manager with DB-level filtering.
   */
  private subscribeWithCustomPrefixFilterPolling(
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
   * Subscribe using polling (protected, available as fallback).
   *
   * Normal subscriptions (no custom prefix filter) share a single polling loop for efficiency.
   * Custom prefix filter subscriptions get their own dedicated polling loop with DB-level filtering.
   *
   * @param callback - Function called when a change occurs
   * @param options - Subscription options including interval and prefix filter
   * @returns Unsubscribe function
   */
  protected subscribeToChangesWithPolling(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    const intervalMs = options?.pollingIntervalMs ?? 1000;

    // Check if this is a custom prefix filter subscription
    if (this.isCustomPrefixFilter(options?.prefixFilter)) {
      // Custom prefix filter - use dedicated polling with DB-level filtering
      return this.subscribeWithCustomPrefixFilterPolling(
        callback,
        options!.prefixFilter!,
        intervalMs
      );
    }

    // Normal subscription - use shared polling manager (efficient)
    const manager = this.getPollingManager();
    return manager.subscribe(callback, { intervalMs });
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import type { Pool } from "@workglow/postgres/storage";
import { createServiceToken, getLogger, makeFingerprint, uuid4 } from "@workglow/util";
import { JobStatus } from "@workglow/job-queue";
import type {
  IQueueStorage,
  JobStorageFormat,
  PrefixColumn,
  QueueChangePayload,
  QueueStorageOptions,
  QueueSubscribeOptions,
} from "@workglow/job-queue";

export const POSTGRES_QUEUE_STORAGE = createServiceToken<IQueueStorage<any, any>>(
  "jobqueue.storage.postgres"
);

/** Regex for safe SQL identifiers: starts with a letter, then alphanumeric/underscores */
const SAFE_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Subset of pg.PoolClient that {@link PostgresQueueStorage.subscribeToChanges}
 * needs. Typed locally so we don't require `pg` types at the storage layer.
 */
interface ListenClient {
  query: (sql: string) => Promise<unknown>;
  release: () => void;
  removeAllListeners?: (event: string) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
}

/**
 * PostgreSQL implementation of a job queue.
 * Provides storage and retrieval for job execution states using PostgreSQL.
 */
export class PostgresQueueStorage<Input, Output> implements IQueueStorage<Input, Output> {
  public readonly scope = "cluster" as const;
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** The table name for the job queue */
  protected readonly tableName: string;

  constructor(
    protected readonly db: Pool,
    protected readonly queueName: string,
    options?: QueueStorageOptions
  ) {
    this.prefixes = options?.prefixes ?? [];
    this.prefixValues = options?.prefixValues ?? {};

    // Validate prefix column names to prevent SQL injection in DDL statements
    for (const prefix of this.prefixes) {
      if (!SAFE_IDENTIFIER.test(prefix.name)) {
        throw new Error(
          `Prefix column name must start with a letter and contain only letters, digits, and underscores, got: ${prefix.name}`
        );
      }
    }

    // Generate table name based on prefix configuration to avoid column conflicts
    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.tableName = `job_queue_${prefixNames}`;
    } else {
      this.tableName = "job_queue";
    }
  }

  /**
   * Gets the SQL column type for a prefix column
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
   * Builds WHERE clause conditions for prefix filtering
   * @param startParam - The starting parameter number for parameterized queries
   * @returns Object with conditions string and parameter values
   */
  private buildPrefixWhereClause(startParam: number): {
    conditions: string;
    params: Array<string | number>;
  } {
    if (this.prefixes.length === 0) {
      return { conditions: "", params: [] };
    }
    const conditions = this.prefixes.map((p, i) => `${p.name} = $${startParam + i}`).join(" AND ");
    const params = this.prefixes.map((p) => this.prefixValues[p.name]);
    return { conditions: " AND " + conditions, params };
  }

  /**
   * Gets prefix values as an array in column order
   */
  private getPrefixParamValues(): Array<string | number> {
    return this.prefixes.map((p) => this.prefixValues[p.name]);
  }

  public async setupDatabase(): Promise<void> {
    let sql: string;
    try {
      const enumValues = Object.values(JobStatus);
      for (const v of enumValues) {
        if (!SAFE_IDENTIFIER.test(v)) {
          throw new Error(`Invalid JobStatus enum value: ${v}`);
        }
      }
      sql = `CREATE TYPE job_status AS ENUM (${enumValues.map((v) => `'${v}'`).join(",")})`;
      await this.db.query(sql);
    } catch (e: any) {
      // Ignore error if type already exists (code 42710)
      if (e.code !== "42710") throw e;
    }

    const prefixColumnsSql = this.buildPrefixColumnsSql();
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixIndexPrefix =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";

    sql = `
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
      worker_id text
    )`;

    await this.db.query(sql);

    // Create indexes with prefix columns prepended
    const indexSuffix = prefixColumnNames.length > 0 ? "_" + prefixColumnNames.join("_") : "";

    sql = `
      CREATE INDEX IF NOT EXISTS job_fetcher${indexSuffix}_idx 
        ON ${this.tableName} (${prefixIndexPrefix}id, status, run_after)`;
    await this.db.query(sql);

    sql = `
      CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx 
        ON ${this.tableName} (${prefixIndexPrefix}queue, status, run_after)`;
    await this.db.query(sql);

    sql = `
      CREATE INDEX IF NOT EXISTS jobs_fingerprint${indexSuffix}_unique_idx
        ON ${this.tableName} (${prefixIndexPrefix}queue, fingerprint, status)`;
    await this.db.query(sql);

    // Install LISTEN/NOTIFY plumbing so subscribers can wake on INSERT/UPDATE
    // without polling. The channel name is derived from md5(table || queue) so
    // (a) it fits Postgres's 63-char identifier limit even with long queue
    // names, and (b) different queues on the same table don't share a channel.
    //
    // Best-effort: in-process Postgres-compatible engines like PGLite may not
    // implement pg_notify or plpgsql. Skip trigger installation in that case
    // — subscribeToChanges will throw synchronously for those engines anyway,
    // so callers fall back to polling.
    const fnName = `${this.tableName}_notify`;
    const trgName = `${this.tableName}_notify_trg`;
    try {
      await this.db.query(`
        CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $fn$
        DECLARE
          channel TEXT := 'wglw_q_' || md5('${this.tableName}' || COALESCE(NEW.queue, OLD.queue));
          payload TEXT;
        BEGIN
          payload := json_build_object(
            'op', TG_OP,
            'id', COALESCE(NEW.id, OLD.id),
            'queue', COALESCE(NEW.queue, OLD.queue),
            'status', COALESCE(NEW.status::text, OLD.status::text)
          )::text;
          PERFORM pg_notify(channel, payload);
          RETURN NULL;
        END;
        $fn$ LANGUAGE plpgsql;
      `);
      await this.db.query(`DROP TRIGGER IF EXISTS ${trgName} ON ${this.tableName}`);
      await this.db.query(`
        CREATE TRIGGER ${trgName}
          AFTER INSERT OR UPDATE ON ${this.tableName}
          FOR EACH ROW EXECUTE FUNCTION ${fnName}();
      `);
    } catch {
      // best-effort — the engine doesn't support LISTEN/NOTIFY; subscribers
      // will get a synchronous throw and fall back to polling.
    }
  }

  /**
   * Channel name for this storage's LISTEN/NOTIFY. Mirrors the trigger's
   * computation so subscriber and notifier agree.
   */
  private notifyChannelName(): string {
    // md5() returns 32 hex chars; combined with the 7-char prefix this is well
    // under Postgres's 63-byte identifier limit.
    const tableAndQueue = `${this.tableName}${this.queueName}`;
    const hash = createHash("md5").update(tableAndQueue).digest("hex");
    return `wglw_q_${hash}`;
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

    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixColumnsInsert =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixParamValues = this.getPrefixParamValues();
    const prefixParamPlaceholders =
      prefixColumnNames.length > 0
        ? prefixColumnNames.map((_, i) => `$${i + 1}`).join(",") + ","
        : "";
    const baseParamStart = prefixColumnNames.length + 1;

    const sql = `
      INSERT INTO ${this.tableName}(
        ${prefixColumnsInsert}queue, 
        fingerprint, 
        input, 
        run_after,
        created_at,
        deadline_at,
        max_retries, 
        job_run_id, 
        progress, 
        progress_message, 
        progress_details
      )
      VALUES 
        (${prefixParamPlaceholders}$${baseParamStart},$${baseParamStart + 1},$${baseParamStart + 2},$${baseParamStart + 3},$${baseParamStart + 4},$${baseParamStart + 5},$${baseParamStart + 6},$${baseParamStart + 7},$${baseParamStart + 8},$${baseParamStart + 9},$${baseParamStart + 10})
      RETURNING id`;
    const params = [
      ...prefixParamValues,
      job.queue,
      job.fingerprint,
      JSON.stringify(job.input),
      job.run_after,
      job.created_at,
      job.deadline_at,
      job.max_retries,
      job.job_run_id,
      job.progress,
      job.progress_message,
      job.progress_details ? JSON.stringify(job.progress_details) : null,
    ];
    const result = await this.db.query(sql, params);

    if (!result) throw new Error("Failed to add to queue");
    job.id = result.rows[0].id;
    return job.id;
  }

  /**
   * Retrieves a job by its ID.
   * @param id - The ID of the job to retrieve
   * @returns The job if found, undefined otherwise
   */
  public async get(id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    const result = await this.db.query(
      `SELECT *
        FROM ${this.tableName}
        WHERE id = $1 AND queue = $2${prefixConditions}
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [id, this.queueName, ...prefixParams]
    );

    if (!result || result.rows.length === 0) return undefined;
    return result.rows[0];
  }

  /**
   * Retrieves a slice of jobs from the queue.
   * @param num - Maximum number of jobs to return
   * @returns An array of jobs
   */
  public async peek(
    status: JobStatus = JobStatus.PENDING,
    num: number = 100
  ): Promise<Array<JobStorageFormat<Input, Output>>> {
    num = Number(num) || 100; // TS does not validate, so ensure it is a number
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(4);
    const result = await this.db.query<
      JobStorageFormat<Input, Output>,
      Array<string | number | JobStatus>
    >(
      `
      SELECT *
        FROM ${this.tableName}
        WHERE queue = $1
        AND status = $2${prefixConditions}
        ORDER BY run_after ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED`,
      [this.queueName, status, num, ...prefixParams]
    );
    if (!result) return [];
    return result.rows;
  }

  /**
   * Retrieves the next available job that is ready to be processed.
   * @param workerId - Worker ID to associate with the job (required)
   * @returns The next job or undefined if no job is available
   */
  public async next(workerId: string): Promise<JobStorageFormat<Input, Output> | undefined> {
    // Parameters: $1=status, $2=queue, $3=status, $4=worker_id, $5+=prefix params
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(5);
    const result = await this.db.query<
      JobStorageFormat<Input, Output>,
      Array<string | number | JobStatus | null>
    >(
      `
      UPDATE ${this.tableName} 
      SET status = $1, last_ran_at = NOW() AT TIME ZONE 'UTC', worker_id = $4
      WHERE id = (
        SELECT id 
        FROM ${this.tableName} 
        WHERE queue = $2 
        AND status = $3
        ${prefixConditions}
        AND run_after <= NOW() AT TIME ZONE 'UTC'
        ORDER BY run_after ASC 
        FOR UPDATE SKIP LOCKED 
        LIMIT 1
      )
      RETURNING *`,
      [JobStatus.PROCESSING, this.queueName, JobStatus.PENDING, workerId, ...prefixParams]
    );

    return result?.rows?.[0] ?? undefined;
  }

  /**
   * Retrieves the number of jobs in the queue with a specific status.
   * @param status - The status of the jobs to count
   * @returns The count of jobs with the specified status
   */
  public async size(status = JobStatus.PENDING): Promise<number> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    const result = await this.db.query<{ count: string }, Array<string | number | JobStatus>>(
      `
      SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE queue = $1
        AND status = $2${prefixConditions}`,
      [this.queueName, status, ...prefixParams]
    );
    if (!result) return 0;
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Marks a job as complete with its output or error.
   * Enhanced error handling:
   * - For a retryable error, increments run_attempts and updates run_after.
   * - Marks a job as FAILED immediately for permanent or generic errors.
   */
  public async complete(jobDetails: JobStorageFormat<Input, Output>): Promise<void> {
    const prefixParams = this.getPrefixParamValues();

    if (jobDetails.status === JobStatus.DISABLED) {
      const { conditions: prefixConditions } = this.buildPrefixWhereClause(4);
      await this.db.query(
        `UPDATE ${this.tableName} 
          SET 
            status = $1, 
            progress = 100,
            progress_message = '',
            progress_details = NULL,
            completed_at = NOW() AT TIME ZONE 'UTC'
          WHERE id = $2 AND queue = $3${prefixConditions}`,
        [jobDetails.status, jobDetails.id, this.queueName, ...prefixParams]
      );
    } else if (jobDetails.status === JobStatus.PENDING) {
      const { conditions: prefixConditions } = this.buildPrefixWhereClause(7);
      await this.db.query(
        `UPDATE ${this.tableName} 
          SET 
            error = $1, 
            error_code = $2,
            status = $3, 
            run_after = $4, 
            progress = 0,
            progress_message = '',
            progress_details = NULL,
            run_attempts = run_attempts + 1, 
            last_ran_at = NOW() AT TIME ZONE 'UTC'
          WHERE id = $5 AND queue = $6${prefixConditions}`,
        [
          jobDetails.error,
          jobDetails.error_code,
          jobDetails.status,
          jobDetails.run_after,
          jobDetails.id,
          this.queueName,
          ...prefixParams,
        ]
      );
    } else {
      const { conditions: prefixConditions } = this.buildPrefixWhereClause(7);
      await this.db.query(
        `
          UPDATE ${this.tableName} 
            SET 
              output = $1, 
              error = $2, 
              error_code = $3,
              status = $4, 
              progress = 100,
              progress_message = '',
              progress_details = NULL,
              run_attempts = run_attempts + 1, 
              completed_at = NOW() AT TIME ZONE 'UTC',
              last_ran_at = NOW() AT TIME ZONE 'UTC'
          WHERE id = $5 AND queue = $6${prefixConditions}`,
        [
          jobDetails.output ? JSON.stringify(jobDetails.output) : null,
          jobDetails.error ?? null,
          jobDetails.error_code ?? null,
          jobDetails.status,
          jobDetails.id,
          this.queueName,
          ...prefixParams,
        ]
      );
    }
  }

  /**
   * Clears all jobs from the queue.
   */
  public async deleteAll(): Promise<void> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(2);
    await this.db.query(
      `
      DELETE FROM ${this.tableName}
        WHERE queue = $1${prefixConditions}`,
      [this.queueName, ...prefixParams]
    );
  }

  /**
   * Looks up cached output for a given input
   * Uses input fingerprinting for efficient matching
   * @returns The cached output or null if not found
   */
  public async outputForInput(input: Input): Promise<Output | null> {
    const fingerprint = await makeFingerprint(input);
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    const result = await this.db.query(
      `
      SELECT output
        FROM ${this.tableName}
        WHERE fingerprint = $1 AND queue = $2 AND status = 'COMPLETED'${prefixConditions}`,
      [fingerprint, this.queueName, ...prefixParams]
    );
    if (!result || result.rows.length === 0) return null;
    return result.rows[0].output;
  }

  /**
   * Aborts a job by setting its status to "ABORTING".
   * This method will signal the corresponding AbortController so that
   * the job's execute() method (if it supports an AbortSignal parameter)
   * can clean up and exit.
   */
  public async abort(jobId: unknown): Promise<void> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    await this.db.query(
      `
      UPDATE ${this.tableName} 
      SET status = 'ABORTING' 
      WHERE id = $1 AND queue = $2${prefixConditions}`,
      [jobId, this.queueName, ...prefixParams]
    );
  }

  /**
   * Releases a claimed job back to PENDING without incrementing run_attempts.
   * @param jobId - The id of the claimed job to release.
   */
  public async release(jobId: unknown): Promise<void> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    await this.db.query(
      `
      UPDATE ${this.tableName}
        SET status = 'PENDING',
            worker_id = NULL,
            progress = 0,
            progress_message = '',
            progress_details = NULL
        WHERE id = $1 AND queue = $2${prefixConditions}`,
      [jobId, this.queueName, ...prefixParams]
    );
  }

  /**
   * Retrieves all jobs for a given job run ID.
   * @param job_run_id - The ID of the job run to retrieve
   * @returns An array of jobs
   */
  public async getByRunId(job_run_id: string): Promise<Array<JobStorageFormat<Input, Output>>> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    const result = await this.db.query(
      `
      SELECT * FROM ${this.tableName} WHERE job_run_id = $1 AND queue = $2${prefixConditions}`,
      [job_run_id, this.queueName, ...prefixParams]
    );
    if (!result) return [];
    return result.rows;
  }

  /**
   * Implements the abstract saveProgress method from JobQueue
   */
  public async saveProgress(
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, any>
  ): Promise<void> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(6);
    await this.db.query(
      `
      UPDATE ${this.tableName} 
      SET progress = $1,
          progress_message = $2,
          progress_details = $3
      WHERE id = $4 AND queue = $5${prefixConditions}`,
      [
        progress,
        message,
        details ? JSON.stringify(details) : null,
        jobId,
        this.queueName,
        ...prefixParams,
      ]
    );
  }

  /**
   * Deletes a job by its ID
   */
  public async delete(jobId: unknown): Promise<void> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    await this.db.query(
      `DELETE FROM ${this.tableName} WHERE id = $1 AND queue = $2${prefixConditions}`,
      [jobId, this.queueName, ...prefixParams]
    );
  }

  /**
   * Delete jobs with a specific status older than a cutoff date
   * @param status - Status of jobs to delete
   * @param olderThanMs - Delete jobs completed more than this many milliseconds ago
   */
  public async deleteJobsByStatusAndAge(status: JobStatus, olderThanMs: number): Promise<void> {
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(4);
    await this.db.query(
      `DELETE FROM ${this.tableName} 
       WHERE queue = $1 
       AND status = $2 
       AND completed_at IS NOT NULL 
       AND completed_at <= $3${prefixConditions}`,
      [this.queueName, status, cutoffDate, ...prefixParams]
    );
  }

  /**
   * Subscribe to INSERT/UPDATE notifications via PostgreSQL LISTEN/NOTIFY.
   * Replaces 100ms-poll fallback for cluster Postgres deployments — workers
   * wake within network-latency of an actual change rather than on a timer.
   *
   * Acquires a dedicated client from the pool (LISTEN occupies a connection
   * for its lifetime). On unsubscribe, runs UNLISTEN and releases the client.
   * On connection loss, attempts to reconnect with bounded backoff and
   * re-LISTEN. After every successful (re)connect — including the initial
   * one — emits a synthetic `{ type: "RESYNC" }` event so subscribers can
   * re-poll state and pick up any rows inserted during the disconnect window
   * (or between subscribe and the first NOTIFY landing).
   *
   * Throws synchronously when the underlying pool lacks `connect()`
   * (single-connection wrappers like PGLite) so the caller's try/catch can
   * fall back to polling. JobQueueServer.start does this and logs at debug.
   *
   * `options.prefixFilter` follows {@link QueueSubscribeOptions.prefixFilter}:
   * `undefined` means "use the storage instance's configured prefixValues",
   * `{}` means "receive all changes regardless of prefix".
   */
  public subscribeToChanges(
    callback: (change: QueueChangePayload<Input, Output>) => void,
    options?: QueueSubscribeOptions
  ): () => void {
    type PoolWithConnect = { connect: () => Promise<ListenClient> };
    const poolMaybe = this.db as unknown as Partial<PoolWithConnect>;
    if (typeof poolMaybe.connect !== "function") {
      // Detect synchronously so callers can catch and fall back to polling
      // without leaving a dangling unhandled promise rejection behind.
      throw new Error(
        "PostgresQueueStorage.subscribeToChanges requires a pg.Pool (got a single-connection wrapper)"
      );
    }
    const pool = poolMaybe as PoolWithConnect;

    const channel = this.notifyChannelName();
    // undefined -> default to instance prefixValues; {} -> no filtering;
    // partial -> filter by the provided subset (matches QueueSubscribeOptions docs).
    const effectivePrefixFilter: Readonly<Record<string, string | number>> | null =
      options?.prefixFilter === undefined
        ? this.prefixes.length > 0
          ? this.prefixValues
          : null
        : Object.keys(options.prefixFilter).length === 0
          ? null
          : options.prefixFilter;

    let unsubscribed = false;
    let activeClient: ListenClient | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 250;

    const dispatch = (change: QueueChangePayload<Input, Output>): void => {
      try {
        callback(change);
      } catch (err) {
        // Never let user callbacks tear down the listener loop.
        getLogger().debug("PostgresQueueStorage subscribe callback threw", {
          channel,
          changeType: change.type,
          error: err,
        });
      }
    };

    const matchesPrefix = (
      change: QueueChangePayload<Input, Output>,
      filter: Readonly<Record<string, string | number>>
    ): boolean => {
      const row = (change.new ?? change.old) as Record<string, unknown> | undefined;
      if (!row) return false;
      for (const [k, v] of Object.entries(filter)) {
        if (row[k] !== v) return false;
      }
      return true;
    };

    // Hydrate the row referenced by a notification. Postgres NOTIFY is capped
    // at 8 KB so we ship only {id, queue, status} in the payload and fetch the
    // full row here — keeps subscriber payloads consistent with other backends
    // (e.g. Supabase realtime, IndexedDb) and lets prefixFilter inspect the
    // prefix columns the row actually has.
    const hydrate = async (id: unknown): Promise<JobStorageFormat<Input, Output> | undefined> => {
      try {
        return await this.get(id);
      } catch {
        return undefined;
      }
    };

    const handleNotification = (msg: { channel: string; payload?: string }): void => {
      if (msg.channel !== channel || !msg.payload) return;
      let parsed: { op: string; id: number; queue: string; status: string };
      try {
        parsed = JSON.parse(msg.payload);
      } catch {
        return;
      }
      void (async () => {
        const op = parsed.op;
        const fallback = {
          id: parsed.id,
          queue: parsed.queue,
          status: parsed.status,
        } as unknown as JobStorageFormat<Input, Output>;
        const fullRow = op === "DELETE" ? undefined : await hydrate(parsed.id);
        const change: QueueChangePayload<Input, Output> = {
          type: op === "INSERT" ? "INSERT" : op === "DELETE" ? "DELETE" : "UPDATE",
          new: op === "DELETE" ? undefined : (fullRow ?? fallback),
          old: op === "DELETE" ? fallback : undefined,
        };
        if (effectivePrefixFilter && !matchesPrefix(change, effectivePrefixFilter)) return;
        dispatch(change);
      })();
    };

    const connect = async (): Promise<void> => {
      if (unsubscribed) return;
      try {
        const client = await pool.connect();
        if (unsubscribed) {
          client.release();
          return;
        }
        activeClient = client;
        client.on("notification", handleNotification);
        client.on("error", () => scheduleReconnect());
        await client.query(`LISTEN ${channel}`);
        backoffMs = 250; // reset on successful (re)connect
        // Synthetic resync: any rows inserted between subscribe and LISTEN
        // landing (or during a reconnect window) have no NOTIFY backing.
        // Fire a no-payload event so subscribers can re-poll state.
        dispatch({ type: "RESYNC" });
      } catch {
        scheduleReconnect();
      }
    };

    const scheduleReconnect = (): void => {
      if (unsubscribed || reconnectTimer) return;
      const c = activeClient;
      activeClient = null;
      try {
        c?.removeAllListeners?.("notification");
        c?.removeAllListeners?.("error");
        c?.release();
      } catch {
        // best-effort
      }
      const delay = Math.min(backoffMs, 30_000);
      backoffMs = Math.min(backoffMs * 2, 30_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    void connect();

    return () => {
      unsubscribed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const c = activeClient;
      activeClient = null;
      if (c) {
        // Best-effort UNLISTEN; ignore errors (connection may already be dead).
        c.query(`UNLISTEN ${channel}`)
          .catch(() => {})
          .finally(() => {
            try {
              c.removeAllListeners?.("notification");
              c.removeAllListeners?.("error");
              c.release();
            } catch {
              // best-effort
            }
          });
      }
    };
  }
}

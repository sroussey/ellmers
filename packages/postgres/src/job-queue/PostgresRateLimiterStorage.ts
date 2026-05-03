/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { Pool } from "@workglow/postgres/storage";
import type { PrefixColumn } from "@workglow/job-queue";
import type {
  IRateLimiterStorage,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "@workglow/job-queue";

export const POSTGRES_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.postgres"
);

/**
 * PostgreSQL implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class PostgresRateLimiterStorage implements IRateLimiterStorage {
  public readonly scope: RateLimiterStorageScope = "cluster";
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** The table name for execution tracking */
  protected readonly executionTableName: string;
  /** The table name for next available times */
  protected readonly nextAvailableTableName: string;

  constructor(
    protected readonly db: Pool,
    options?: RateLimiterStorageOptions
  ) {
    this.prefixes = options?.prefixes ?? [];
    this.prefixValues = options?.prefixValues ?? {};

    // Generate table names based on prefix configuration
    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.executionTableName = `rate_limit_executions_${prefixNames}`;
      this.nextAvailableTableName = `rate_limit_next_available_${prefixNames}`;
    } else {
      this.executionTableName = "rate_limit_executions";
      this.nextAvailableTableName = "rate_limit_next_available";
    }
  }

  /**
   * Gets the SQL column type for a prefix column.
   */
  private getPrefixColumnType(type: PrefixColumn["type"]): string {
    return type === "uuid" ? "UUID" : "INTEGER";
  }

  /**
   * Builds the prefix columns SQL for CREATE TABLE.
   */
  private buildPrefixColumnsSql(): string {
    if (this.prefixes.length === 0) return "";
    return (
      this.prefixes
        .map((p) => `${p.name} ${this.getPrefixColumnType(p.type)} NOT NULL`)
        .join(",\n        ") + ",\n        "
    );
  }

  /**
   * Builds prefix column names for use in queries.
   */
  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  /**
   * Builds WHERE clause conditions for prefix filtering.
   * @param startParam - The starting parameter number for parameterized queries
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
   * Gets prefix values as an array in column order.
   */
  private getPrefixParamValues(): Array<string | number> {
    return this.prefixes.map((p) => this.prefixValues[p.name]);
  }

  public async setupDatabase(): Promise<void> {
    const prefixColumnsSql = this.buildPrefixColumnsSql();
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixIndexPrefix =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const indexSuffix = prefixColumnNames.length > 0 ? "_" + prefixColumnNames.join("_") : "";

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS ${this.executionTableName} (
        id SERIAL PRIMARY KEY,
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS rate_limit_exec_queue${indexSuffix}_idx 
        ON ${this.executionTableName} (${prefixIndexPrefix}queue_name, executed_at)
    `);

    // For the next_available table, we need a composite primary key with prefixes
    const primaryKeyColumns =
      prefixColumnNames.length > 0 ? `${prefixColumnNames.join(", ")}, queue_name` : "queue_name";

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS ${this.nextAvailableTableName} (
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        next_available_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (${primaryKeyColumns})
      )
    `);
  }

  public async tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null> {
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixParamValues = this.getPrefixParamValues();
    const prefixCount = prefixColumnNames.length;

    // Parameter layout:
    //   $1..$N           prefix values (used in lock-key, count, next-available, and INSERT)
    //   $(N+1)           queueName
    //   $(N+2)           windowStart timestamp
    //   $(N+3)           maxExecutions
    const queueParam = `$${prefixCount + 1}`;
    const windowStartParam = `$${prefixCount + 2}`;

    // For the advisory lock we hash table-name + prefix values + queue-name into a bigint.
    // Use hashtextextended which returns int8 (advisory_xact_lock takes bigint).
    const lockKeyParts: string[] = [`'${this.executionTableName}'`];
    for (let i = 0; i < prefixCount; i++) {
      lockKeyParts.push(`$${i + 1}::text`);
    }
    lockKeyParts.push(`${queueParam}::text`);
    const lockKeyExpr = `hashtextextended(${lockKeyParts.join(" || '|' || ")}, 0)`;

    const prefixWhere =
      prefixCount > 0
        ? " AND " +
          prefixColumnNames
            .map((p, i) => `${p} = $${i + 1}`)
            .join(" AND ")
        : "";

    const prefixInsertCols = prefixCount > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixInsertPlaceholders =
      prefixCount > 0 ? prefixColumnNames.map((_, i) => `$${i + 1}`).join(", ") + ", " : "";

    const windowStart = new Date(Date.now() - windowMs).toISOString();

    // Use a dedicated client when the pool supports connect() (real pg.Pool)
    // — the advisory xact lock + transaction MUST run on the same connection
    // for atomicity. Without connect(), only known single-connection wrappers
    // (PGLitePool, raw PGlite) are safe, since they implicitly serialize all
    // queries through one underlying connection. Anything else (e.g. a custom
    // multi-connection adapter without connect()) would dispatch the lock and
    // the INSERT to different sessions, defeating the lock entirely.
    const supportsConnect =
      typeof (this.db as unknown as { connect?: unknown }).connect === "function";
    if (!supportsConnect) {
      // Without connect() we run BEGIN/advisory_lock/INSERT/COMMIT directly on
      // `db.query`. That's only safe if `db` is a single-connection wrapper
      // (every query goes through the same underlying session). Recognize:
      //   - PGLitePool  — our own wrapper class; constructor name preserved.
      //   - PGlite      — third-party, ships minified so `constructor.name`
      //     can be obfuscated (observed: "q"). Detect via duck-typing on
      //     methods PGlite uniquely exposes (`waitReady` Promise + `exec`).
      // Any other no-connect() pool would dispatch the lock and the INSERT
      // to potentially different sessions, breaking atomicity.
      const dbAny = this.db as unknown as {
        waitReady?: unknown;
        exec?: unknown;
        constructor?: { name?: string };
      };
      const ctorName = dbAny.constructor?.name;
      const looksLikePGlite =
        typeof dbAny.exec === "function" && dbAny.waitReady !== undefined;
      const looksLikePGLitePool = ctorName === "PGLitePool";
      if (!looksLikePGlite && !looksLikePGLitePool) {
        throw new Error(
          `PostgresRateLimiterStorage.tryReserveExecution requires a pg.Pool with connect() or a known single-connection wrapper (PGLitePool, PGlite); got ${ctorName ?? typeof this.db}. A multi-connection pool without connect() would dispatch the advisory lock and the INSERT to different sessions, breaking atomicity.`
        );
      }
    }
    const conn = supportsConnect
      ? await (this.db as unknown as { connect: () => Promise<{
          query: Pool["query"];
          release: () => void;
        }> }).connect()
      : { query: this.db.query.bind(this.db), release: () => {} };

    try {
      await conn.query("BEGIN");
      try {
        await conn.query(
          `SELECT pg_advisory_xact_lock(${lockKeyExpr})`,
          [...prefixParamValues, queueName]
        );

        const countResult = await conn.query(
          `
          SELECT COUNT(*)::int AS n
          FROM ${this.executionTableName}
          WHERE queue_name = ${queueParam} AND executed_at > ${windowStartParam}${prefixWhere}
          `,
          [...prefixParamValues, queueName, windowStart]
        );
        const n: number = countResult.rows[0]?.n ?? 0;
        if (n >= maxExecutions) {
          await conn.query("COMMIT");
          return null;
        }

        const naResult = await conn.query(
          `
          SELECT next_available_at
          FROM ${this.nextAvailableTableName}
          WHERE queue_name = ${queueParam}${prefixWhere}
          `,
          [...prefixParamValues, queueName]
        );
        const nextAvailableAt: Date | null = naResult.rows[0]?.next_available_at ?? null;
        if (nextAvailableAt && new Date(nextAvailableAt).getTime() > Date.now()) {
          await conn.query("COMMIT");
          return null;
        }

        const insertResult = await conn.query(
          `
          INSERT INTO ${this.executionTableName} (${prefixInsertCols}queue_name)
          VALUES (${prefixInsertPlaceholders}${queueParam})
          RETURNING id
          `,
          [...prefixParamValues, queueName]
        );
        await conn.query("COMMIT");
        return insertResult.rows[0]?.id ?? null;
      } catch (err) {
        try {
          await conn.query("ROLLBACK");
        } catch {
          // best-effort
        }
        throw err;
      }
    } finally {
      conn.release();
    }
  }

  public async releaseExecution(queueName: string, token: unknown): Promise<void> {
    if (token === null || token === undefined) return;
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);
    // Delete by id — NEVER by recency. Two concurrent acquirers can hold
    // tokens for different rows; deleting "the most recent" would release the
    // other worker's slot.
    await this.db.query(
      `DELETE FROM ${this.executionTableName} WHERE id = $1 AND queue_name = $2${prefixConditions}`,
      [token as string | number, queueName, ...prefixParams]
    );
  }

  public async recordExecution(queueName: string): Promise<void> {
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixColumnsInsert =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixParamValues = this.getPrefixParamValues();
    const prefixParamPlaceholders =
      prefixColumnNames.length > 0
        ? prefixColumnNames.map((_, i) => `$${i + 1}`).join(", ") + ", "
        : "";
    const queueParamNum = prefixColumnNames.length + 1;

    await this.db.query(
      `
      INSERT INTO ${this.executionTableName} (${prefixColumnsInsert}queue_name)
      VALUES (${prefixParamPlaceholders}$${queueParamNum})
    `,
      [...prefixParamValues, queueName]
    );
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);

    const result = await this.db.query(
      `
      SELECT COUNT(*) AS count
      FROM ${this.executionTableName}
      WHERE queue_name = $1 AND executed_at > $2${prefixConditions}
    `,
      [queueName, windowStartTime, ...prefixParams]
    );

    return parseInt(result.rows[0]?.count ?? "0", 10);
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(3);

    const result = await this.db.query(
      `
      SELECT executed_at
      FROM ${this.executionTableName}
      WHERE queue_name = $1${prefixConditions}
      ORDER BY executed_at ASC
      LIMIT 1 OFFSET $2
    `,
      [queueName, offset, ...prefixParams]
    );

    const executedAt = result.rows[0]?.executed_at;
    if (!executedAt) return undefined;
    return new Date(executedAt).toISOString();
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(2);

    const result = await this.db.query(
      `
      SELECT next_available_at
      FROM ${this.nextAvailableTableName}
      WHERE queue_name = $1${prefixConditions}
    `,
      [queueName, ...prefixParams]
    );

    const nextAvailableAt = result.rows[0]?.next_available_at;
    if (!nextAvailableAt) return undefined;
    return new Date(nextAvailableAt).toISOString();
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixColumnsInsert =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixParamValues = this.getPrefixParamValues();
    const prefixParamPlaceholders =
      prefixColumnNames.length > 0
        ? prefixColumnNames.map((_, i) => `$${i + 1}`).join(", ") + ", "
        : "";
    const baseParamStart = prefixColumnNames.length + 1;

    // Build the conflict columns for upsert
    const conflictColumns =
      prefixColumnNames.length > 0 ? `${prefixColumnNames.join(", ")}, queue_name` : "queue_name";

    await this.db.query(
      `
      INSERT INTO ${this.nextAvailableTableName} (${prefixColumnsInsert}queue_name, next_available_at)
      VALUES (${prefixParamPlaceholders}$${baseParamStart}, $${baseParamStart + 1})
      ON CONFLICT (${conflictColumns})
      DO UPDATE SET next_available_at = EXCLUDED.next_available_at
    `,
      [...prefixParamValues, queueName, nextAvailableAt]
    );
  }

  public async clear(queueName: string): Promise<void> {
    const { conditions: prefixConditions, params: prefixParams } = this.buildPrefixWhereClause(2);

    await this.db.query(
      `DELETE FROM ${this.executionTableName} WHERE queue_name = $1${prefixConditions}`,
      [queueName, ...prefixParams]
    );
    await this.db.query(
      `DELETE FROM ${this.nextAvailableTableName} WHERE queue_name = $1${prefixConditions}`,
      [queueName, ...prefixParams]
    );
  }
}

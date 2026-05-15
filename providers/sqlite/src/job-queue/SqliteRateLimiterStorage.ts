/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IRateLimiterStorage,
  PrefixColumn,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "@workglow/job-queue";
import type { Sqlite } from "@workglow/sqlite/storage";
import {
  assertPrefixesSafe,
  buildPrefixWhereClause,
  getPrefixColumnNames,
  getPrefixParamValues,
  SqliteDialect,
} from "@workglow/storage";
import { createServiceToken, sleep, toSQLiteTimestamp } from "@workglow/util";
import { SqliteMigrationRunner } from "../migrations/SqliteMigrationRunner";
import { sqliteRateLimiterMigrations } from "../migrations/sqliteRateLimiterMigrations";

export const SQLITE_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.sqlite"
);

/**
 * SQLite implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class SqliteRateLimiterStorage implements IRateLimiterStorage {
  /**
   * `"process"` because a typical SQLite deployment uses a single-process
   * file. Multi-process SQLite (multiple worker processes opening the same
   * file) is not safe for rate limiting even with WAL — separate processes
   * can interleave between BEGIN IMMEDIATE acquisition retries.
   */
  public readonly scope: RateLimiterStorageScope = "process";
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** The table name for execution tracking */
  protected readonly executionTableName: string;
  /** The table name for next available times */
  protected readonly nextAvailableTableName: string;

  constructor(
    protected readonly db: Sqlite.Database,
    options?: RateLimiterStorageOptions
  ) {
    this.prefixes = options?.prefixes ?? [];
    this.prefixValues = options?.prefixValues ?? {};
    // Validate prefix column names before deriving table names from them.
    assertPrefixesSafe(this.prefixes);

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

  /** WHERE-clause helper for the SQLite dialect. */
  private buildPrefixWhereClause(): string {
    return buildPrefixWhereClause(SqliteDialect, this.prefixes, this.prefixValues).conditions;
  }

  /** Returns prefix values in column order. */
  private getPrefixParamValues(): Array<string | number> {
    return getPrefixParamValues(this.prefixes, this.prefixValues);
  }

  /**
   * Returns the versioned migrations that this storage's tables depend on.
   * Callers can compose them with other storages' migrations under a shared
   * {@link SqliteMigrationRunner}; otherwise call {@link migrate}.
   */
  public getMigrations() {
    return sqliteRateLimiterMigrations(
      this.executionTableName,
      this.nextAvailableTableName,
      this.prefixes
    );
  }

  /** Applies any pending migrations for this rate limiter's tables. */
  public async migrate(): Promise<void> {
    await sleep(0);
    await new SqliteMigrationRunner(this.db).run(this.getMigrations());
  }

  public async tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null> {
    const prefixColumnNames = getPrefixColumnNames(this.prefixes);
    const prefixParamValues = this.getPrefixParamValues();
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixColumnsInsert =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixPlaceholders =
      prefixColumnNames.length > 0 ? prefixColumnNames.map(() => "?").join(", ") + ", " : "";

    const windowStart = toSQLiteTimestamp(new Date(Date.now() - windowMs))!;

    // Use a synchronous transaction so the count + insert is atomic against
    // other writers. The canonical Sqlite.Database.transaction() returns void
    // by contract, so we capture the inserted id via a closure variable.
    let insertedId: number | bigint | null = null;
    const txn = this.db.transaction((): void => {
      const countStmt = this.db.prepare<unknown[], { count: number }>(`
        SELECT COUNT(*) AS count
        FROM ${this.executionTableName}
        WHERE queue_name = ? AND executed_at > ?${prefixConditions}
      `);
      const countRow = countStmt.get(queueName, windowStart, ...prefixParamValues);
      if ((countRow?.count ?? 0) >= maxExecutions) {
        return;
      }

      const naStmt = this.db.prepare<unknown[], { next_available_at: string }>(`
        SELECT next_available_at
        FROM ${this.nextAvailableTableName}
        WHERE queue_name = ?${prefixConditions}
      `);
      const naRow = naStmt.get(queueName, ...prefixParamValues);
      if (naRow?.next_available_at) {
        const nextAvailable = new Date(naRow.next_available_at + "Z").getTime();
        if (nextAvailable > Date.now()) {
          return;
        }
      }

      const insertStmt = this.db.prepare(`
        INSERT INTO ${this.executionTableName} (${prefixColumnsInsert}queue_name)
        VALUES (${prefixPlaceholders}?)
      `);
      const info = insertStmt.run(...prefixParamValues, queueName);
      insertedId = info.lastInsertRowid;
    });

    txn();
    if (insertedId == null) return null;
    // Coerce bigint to number when it fits — primary key here is a SQLite
    // INTEGER which always fits in JS Number for any practical row count.
    return typeof insertedId === "bigint" ? Number(insertedId) : insertedId;
  }

  public async releaseExecution(queueName: string, token: unknown): Promise<void> {
    if (token === null || token === undefined) return;
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();
    // Delete by id — NEVER by recency. Two concurrent acquirers can hold
    // tokens for different rows; deleting "the most recent" would release the
    // other worker's slot.
    this.db
      .prepare(
        `DELETE FROM ${this.executionTableName} WHERE id = ? AND queue_name = ?${prefixConditions}`
      )
      .run(token as number, queueName, ...prefixParams);
  }

  public async recordExecution(queueName: string): Promise<void> {
    const prefixColumnNames = getPrefixColumnNames(this.prefixes);
    const prefixColumnsInsert =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixPlaceholders =
      prefixColumnNames.length > 0 ? prefixColumnNames.map(() => "?").join(", ") + ", " : "";
    const prefixParamValues = this.getPrefixParamValues();

    const stmt = this.db.prepare(`
      INSERT INTO ${this.executionTableName} (${prefixColumnsInsert}queue_name)
      VALUES (${prefixPlaceholders}?)
    `);
    stmt.run(...prefixParamValues, queueName);
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();
    const thresholdTime = toSQLiteTimestamp(new Date(windowStartTime));

    const stmt = this.db.prepare<unknown[], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM ${this.executionTableName}
      WHERE queue_name = ? AND executed_at > ?${prefixConditions}
    `);
    const result = stmt.get(queueName, thresholdTime!, ...prefixParams);
    return result?.count ?? 0;
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const stmt = this.db.prepare<unknown[], { executed_at: string }>(`
      SELECT executed_at
      FROM ${this.executionTableName}
      WHERE queue_name = ?${prefixConditions}
      ORDER BY executed_at ASC
      LIMIT 1 OFFSET ?
    `);
    const result = stmt.get(queueName, ...prefixParams, offset);
    if (!result) return undefined;
    // SQLite stores times without timezone, add Z for UTC
    return result.executed_at + "Z";
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    const stmt = this.db.prepare<unknown[], { next_available_at: string }>(`
      SELECT next_available_at
      FROM ${this.nextAvailableTableName}
      WHERE queue_name = ?${prefixConditions}
    `);
    const result = stmt.get(queueName, ...prefixParams);
    if (!result?.next_available_at) return undefined;
    // SQLite stores times without timezone, add Z for UTC
    return result.next_available_at + "Z";
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    const prefixColumnNames = getPrefixColumnNames(this.prefixes);
    const prefixColumnsInsert =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const prefixPlaceholders =
      prefixColumnNames.length > 0 ? prefixColumnNames.map(() => "?").join(", ") + ", " : "";
    const prefixParamValues = this.getPrefixParamValues();

    const stmt = this.db.prepare(`
      INSERT INTO ${this.nextAvailableTableName} (${prefixColumnsInsert}queue_name, next_available_at)
      VALUES (${prefixPlaceholders}?, ?)
      ON CONFLICT(queue_name) DO UPDATE SET next_available_at = excluded.next_available_at
    `);
    stmt.run(...prefixParamValues, queueName, nextAvailableAt);
  }

  public async clear(queueName: string): Promise<void> {
    const prefixConditions = this.buildPrefixWhereClause();
    const prefixParams = this.getPrefixParamValues();

    this.db
      .prepare(`DELETE FROM ${this.executionTableName} WHERE queue_name = ?${prefixConditions}`)
      .run(queueName, ...prefixParams);
    this.db
      .prepare(`DELETE FROM ${this.nextAvailableTableName} WHERE queue_name = ?${prefixConditions}`)
      .run(queueName, ...prefixParams);
  }
}

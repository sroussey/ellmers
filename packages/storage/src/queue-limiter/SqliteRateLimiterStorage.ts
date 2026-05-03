/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sqlite } from "@workglow/storage/sqlite";
import { createServiceToken, sleep, toSQLiteTimestamp } from "@workglow/util";
import type { PrefixColumn } from "../queue/IQueueStorage";
import {
  IRateLimiterStorage,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "./IRateLimiterStorage";

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
   * Gets the SQL column type for a prefix column (SQLite uses TEXT for uuid).
   */
  private getPrefixColumnType(type: PrefixColumn["type"]): string {
    return type === "uuid" ? "TEXT" : "INTEGER";
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
   */
  private buildPrefixWhereClause(): string {
    if (this.prefixes.length === 0) {
      return "";
    }
    const conditions = this.prefixes.map((p) => `${p.name} = ?`).join(" AND ");
    return " AND " + conditions;
  }

  /**
   * Gets prefix values as an array in column order.
   */
  private getPrefixParamValues(): Array<string | number> {
    return this.prefixes.map((p) => this.prefixValues[p.name]);
  }

  public async setupDatabase(): Promise<void> {
    await sleep(0);
    const prefixColumnsSql = this.buildPrefixColumnsSql();
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixIndexPrefix =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const indexSuffix = prefixColumnNames.length > 0 ? "_" + prefixColumnNames.join("_") : "";

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.executionTableName} (
        id INTEGER PRIMARY KEY,
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        executed_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS rate_limit_exec_queue${indexSuffix}_idx 
        ON ${this.executionTableName} (${prefixIndexPrefix}queue_name, executed_at);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.nextAvailableTableName} (
        ${prefixColumnsSql}queue_name TEXT PRIMARY KEY,
        next_available_at TEXT
      );
    `);
  }

  public async tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null> {
    const prefixColumnNames = this.getPrefixColumnNames();
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
    const prefixColumnNames = this.getPrefixColumnNames();
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
    const prefixColumnNames = this.getPrefixColumnNames();
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

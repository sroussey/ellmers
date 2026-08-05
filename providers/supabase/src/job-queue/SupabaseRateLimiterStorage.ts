/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IRateLimiterStorage,
  PrefixColumn,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "@workglow/job-queue";
import {
  buildPrefixColumnsSql,
  getPrefixColumnNames,
  getPrefixIndexPrefix,
  getPrefixIndexSuffix,
  PostgresDialect,
  prefixColumnType,
} from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { isExecSqlUnavailable, isMissingRelationError } from "../supabasePostgrest";

export const SUPABASE_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.supabase"
);

/**
 * Supabase implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class SupabaseRateLimiterStorage implements IRateLimiterStorage {
  public readonly scope: RateLimiterStorageScope = "cluster";
  protected readonly client: SupabaseClient;
  protected readonly prefixes: readonly PrefixColumn[];
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  protected readonly executionTableName: string;
  protected readonly nextAvailableTableName: string;

  constructor(client: unknown, options?: RateLimiterStorageOptions) {
    this.client = client as SupabaseClient;
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
   * Builds prefix column names for use in queries.
   */
  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  /**
   * Applies prefix filters to a Supabase query builder.
   */
  private applyPrefixFilters<T>(query: T): T {
    let result = query as any;
    for (const prefix of this.prefixes) {
      result = result.eq(prefix.name, this.prefixValues[prefix.name]);
    }
    return result as T;
  }

  /**
   * Gets prefix values as an object for inserts.
   */
  private getPrefixInsertValues(): Record<string, string | number> {
    const values: Record<string, string | number> = {};
    for (const prefix of this.prefixes) {
      values[prefix.name] = this.prefixValues[prefix.name];
    }
    return values;
  }

  /**
   * Verifies rate-limiter tables exist. Production schema should come from
   * migrations; when tables are missing we optionally bootstrap via `exec_sql`
   * (PGlite test mock / local dev with that RPC installed).
   */
  public async migrate(): Promise<void> {
    const missing = await this.probeRateLimiterTables();
    if (missing.length === 0) return;

    const bootstrapped = await this.tryBootstrapRateLimiterViaExecSql();
    if (bootstrapped) {
      const stillMissing = await this.probeRateLimiterTables();
      if (stillMissing.length === 0) return;
      throw this.missingRateLimiterTableError(stillMissing[0]!);
    }

    throw this.missingRateLimiterTableError(missing[0]!);
  }

  private missingRateLimiterTableError(error: {
    table: string;
    code?: string;
    message?: string;
  }): Error {
    return new Error(
      `Supabase rate-limiter table "${error.table}" is missing. Run Supabase migrations to create the rate-limiter schema (tables + ${this.atomicReserveFunctionName()} function) before initializing the limiter. (PostgREST: ${error.code ?? "?"} ${error.message})`
    );
  }

  private async probeRateLimiterTables(): Promise<
    Array<{ table: string; code?: string; message?: string }>
  > {
    const missing: Array<{ table: string; code?: string; message?: string }> = [];
    for (const table of [this.executionTableName, this.nextAvailableTableName]) {
      const { error } = await this.client
        .from(table)
        .select("*", { head: true, count: "exact" })
        .limit(0);
      if (!error) continue;
      if (isMissingRelationError(error)) {
        missing.push({ table, code: error.code, message: error.message });
        continue;
      }
      throw error;
    }
    return missing;
  }

  private async tryBootstrapRateLimiterViaExecSql(): Promise<boolean> {
    const prefixColumnsSql = buildPrefixColumnsSql(PostgresDialect, this.prefixes);
    const prefixColumnNames = getPrefixColumnNames(this.prefixes);
    const prefixIndexPrefix = getPrefixIndexPrefix(this.prefixes);
    const indexSuffix = getPrefixIndexSuffix(this.prefixes);
    const primaryKeyColumns =
      prefixColumnNames.length > 0 ? `${prefixColumnNames.join(", ")}, queue_name` : "queue_name";

    const createExecTableSql = `
      CREATE TABLE IF NOT EXISTS ${this.executionTableName} (
        id SERIAL PRIMARY KEY,
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    const { error: execTableError } = await this.client.rpc("exec_sql", {
      query: createExecTableSql,
    });
    if (execTableError) {
      if (isExecSqlUnavailable(execTableError)) return false;
      if (execTableError.code !== "42P07" && !execTableError.message?.includes("already exists")) {
        throw execTableError;
      }
    }

    const createExecIndexSql = `
      CREATE INDEX IF NOT EXISTS rate_limit_exec_queue${indexSuffix}_idx 
        ON ${this.executionTableName} (${prefixIndexPrefix}queue_name, executed_at)
    `;
    const { error: execIndexError } = await this.client.rpc("exec_sql", {
      query: createExecIndexSql,
    });
    if (execIndexError) {
      if (isExecSqlUnavailable(execIndexError)) return false;
      if (execIndexError.code !== "42P07" && !execIndexError.message?.includes("already exists")) {
        throw execIndexError;
      }
    }

    const createNextTableSql = `
      CREATE TABLE IF NOT EXISTS ${this.nextAvailableTableName} (
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        next_available_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (${primaryKeyColumns})
      )
    `;

    const { error: nextTableError } = await this.client.rpc("exec_sql", {
      query: createNextTableSql,
    });
    if (nextTableError) {
      if (isExecSqlUnavailable(nextTableError)) return false;
      if (nextTableError.code !== "42P07" && !nextTableError.message?.includes("already exists")) {
        throw nextTableError;
      }
    }

    const fnName = this.atomicReserveFunctionName();
    const prefixSig = this.prefixes
      .map((p) => `${p.name} ${prefixColumnType(PostgresDialect, p.type)}`)
      .join(", ");
    const prefixSigPrefix = prefixSig ? prefixSig + ", " : "";
    const prefixWhere =
      this.prefixes.length > 0
        ? " AND " + this.prefixes.map((p) => `${p.name} = _${p.name}`).join(" AND ")
        : "";
    const prefixInsertCols =
      this.prefixes.length > 0 ? this.prefixes.map((p) => p.name).join(", ") + ", " : "";
    const prefixInsertVals =
      this.prefixes.length > 0 ? this.prefixes.map((p) => `_${p.name}`).join(", ") + ", " : "";
    const lockKeyParts = [
      `'${this.executionTableName}'`,
      ...this.prefixes.map((p) => `_${p.name}::text`),
      `_queue_name::text`,
    ];
    const lockKeyExpr = `hashtextextended(${lockKeyParts.join(" || '|' || ")}, 0)`;

    const createFnSql = `
      CREATE OR REPLACE FUNCTION ${fnName}(
        ${prefixSigPrefix}_queue_name TEXT, _window_start TIMESTAMPTZ, _max_exec INT
      ) RETURNS BIGINT AS $fn$
      DECLARE
        _count INT;
        _next TIMESTAMPTZ;
        _new_id BIGINT;
      BEGIN
        PERFORM pg_advisory_xact_lock(${lockKeyExpr});
        SELECT COUNT(*) INTO _count FROM ${this.executionTableName}
          WHERE queue_name = _queue_name AND executed_at > _window_start${prefixWhere};
        IF _count >= _max_exec THEN RETURN NULL; END IF;
        SELECT next_available_at INTO _next FROM ${this.nextAvailableTableName}
          WHERE queue_name = _queue_name${prefixWhere};
        IF _next IS NOT NULL AND _next > NOW() THEN RETURN NULL; END IF;
        INSERT INTO ${this.executionTableName} (${prefixInsertCols}queue_name)
          VALUES (${prefixInsertVals}_queue_name)
          RETURNING id INTO _new_id;
        RETURN _new_id;
      END;
      $fn$ LANGUAGE plpgsql;
    `;
    const { error: fnError } = await this.client.rpc("exec_sql", { query: createFnSql });
    if (fnError) {
      if (isExecSqlUnavailable(fnError)) return false;
      throw fnError;
    }

    return true;
  }

  /** Supabase rate-limiter runs DDL via `exec_sql`, not via the migration runner. */
  public getMigrations(): ReadonlyArray<unknown> {
    return [];
  }

  /** Stable function name derived from table name (Postgres identifiers ≤63 chars). */
  private atomicReserveFunctionName(): string {
    return `${this.executionTableName}_try_reserve`.slice(0, 63);
  }

  public async tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null> {
    const args: Record<string, unknown> = {
      _queue_name: queueName,
      _window_start: new Date(Date.now() - windowMs).toISOString(),
      _max_exec: maxExecutions,
    };
    for (const p of this.prefixes) {
      args[`_${p.name}`] = this.prefixValues[p.name];
    }
    // The PL/pgSQL function returns the inserted id BIGINT on success and
    // NULL when capacity is reached or external backoff is active.
    const { data, error } = await this.client.rpc(this.atomicReserveFunctionName(), args);
    if (error) throw error;
    // The function now returns the inserted row id BIGINT (or NULL when
    // capacity is reached). Real Supabase RPC returns the scalar directly;
    // the pglite-backed mock executes `SELECT * FROM fn()` and returns a row
    // array — accept both shapes.
    if (data === null || data === undefined) return null;
    if (Array.isArray(data)) {
      if (data.length === 0) return null;
      const first = Object.values(data[0] as Record<string, unknown>)[0];
      return first ?? null;
    }
    // Supabase RPC returns BIGINTs as either numbers or strings depending on
    // size; both are valid as opaque tokens.
    return data;
  }

  public async releaseExecution(queueName: string, token: unknown): Promise<void> {
    if (token === null || token === undefined) return;
    // Delete by id — NEVER by recency. Two concurrent acquirers can hold
    // tokens for different rows; deleting "the most recent" would release the
    // other worker's slot.
    let del = this.client
      .from(this.executionTableName)
      .delete()
      .eq("id", token as number | string)
      .eq("queue_name", queueName);
    del = this.applyPrefixFilters(del);
    const { error: delError } = await del;
    if (delError) throw delError;
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    let query = this.client
      .from(this.executionTableName)
      .select("*", { count: "exact", head: true })
      .eq("queue_name", queueName)
      .gt("executed_at", windowStartTime);

    query = this.applyPrefixFilters(query);

    const { count, error } = await query;

    if (error) throw error;
    return count ?? 0;
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    let query = this.client
      .from(this.executionTableName)
      .select("executed_at")
      .eq("queue_name", queueName);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query
      .order("executed_at", { ascending: true })
      .range(offset, offset);

    if (error) throw error;
    if (!data || data.length === 0) return undefined;
    return new Date(data[0].executed_at).toISOString();
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    let query = this.client
      .from(this.nextAvailableTableName)
      .select("next_available_at")
      .eq("queue_name", queueName);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return undefined; // Not found
      throw error;
    }

    if (!data?.next_available_at) return undefined;
    return new Date(data.next_available_at).toISOString();
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    const prefixInsertValues = this.getPrefixInsertValues();

    const { error } = await this.client.from(this.nextAvailableTableName).upsert(
      {
        ...prefixInsertValues,
        queue_name: queueName,
        next_available_at: nextAvailableAt,
      },
      {
        onConflict:
          this.prefixes.length > 0
            ? `${this.getPrefixColumnNames().join(",")},queue_name`
            : "queue_name",
      }
    );

    if (error) throw error;
  }

  public async clear(queueName: string): Promise<void> {
    let execQuery = this.client.from(this.executionTableName).delete().eq("queue_name", queueName);
    execQuery = this.applyPrefixFilters(execQuery);
    const { error: execError } = await execQuery;
    if (execError) throw execError;

    let nextQuery = this.client
      .from(this.nextAvailableTableName)
      .delete()
      .eq("queue_name", queueName);
    nextQuery = this.applyPrefixFilters(nextQuery);
    const { error: nextError } = await nextQuery;
    if (nextError) throw nextError;
  }
}

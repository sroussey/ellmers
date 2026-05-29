/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseClient } from "@supabase/supabase-js";
import type {
  IRateLimiterStorage,
  PrefixColumn,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "@workglow/job-queue";
import { createServiceToken } from "@workglow/util";

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
   * Verifies the Supabase rate-limiter tables exist. The schema — both
   * tables, the execution-table index, and the `atomic_reserve_*` plpgsql
   * function — is owned by Supabase migrations. Installing a
   * `CREATE OR REPLACE FUNCTION` from the client required an `exec_sql`
   * admin RPC, which is a privilege-escalation primitive incompatible with
   * RLS. Function presence is implicitly checked the first time `acquire()`
   * issues the RPC; this method fails fast if the backing tables are missing.
   */
  public async migrate(): Promise<void> {
    for (const table of [this.executionTableName, this.nextAvailableTableName]) {
      const { error } = await this.client
        .from(table)
        .select("*", { head: true, count: "exact" })
        .limit(0);
      if (!error) continue;
      if (error.code === "42P01" || error.code === "PGRST205") {
        throw new Error(
          `Supabase rate-limiter table "${table}" is missing. Run Supabase migrations to create the rate-limiter schema (tables + ${this.atomicReserveFunctionName()} function) before initializing the limiter. (PostgREST: ${error.code} ${error.message})`
        );
      }
      throw error;
    }
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

  public async recordExecution(queueName: string): Promise<void> {
    const prefixInsertValues = this.getPrefixInsertValues();

    const { error } = await this.client.from(this.executionTableName).insert({
      ...prefixInsertValues,
      queue_name: queueName,
    });

    if (error) throw error;
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

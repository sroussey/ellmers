/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PGliteInterface, PGliteOptions, Results } from "@electric-sql/pglite";
import type { PoolConfig, QueryConfig, QueryResult, QueryResultRow, Submittable } from "pg";

function toFieldDefs(fields: Results["fields"]): QueryResult["fields"] {
  return fields.map((f) => ({
    name: f.name,
    tableID: 0,
    columnID: 0,
    dataTypeID: f.dataTypeID,
    dataTypeSize: 0,
    dataTypeModifier: 0,
    format: "text" as const,
  }));
}

function toQueryResult<R extends QueryResultRow>(r: Results<R>): QueryResult<R> {
  const rowCount = r.affectedRows ?? r.rows.length;
  return {
    rows: r.rows,
    rowCount,
    command: "",
    oid: 0,
    fields: toFieldDefs(r.fields),
  };
}

function dataDirFromPoolConfig(config?: PoolConfig): string {
  if (!config) {
    return "memory://";
  }
  const extended = config as PoolConfig & { dataDir?: string; pglite?: { dataDir?: string } };
  if (typeof extended.dataDir === "string") {
    return extended.dataDir;
  }
  if (extended.pglite && typeof extended.pglite.dataDir === "string") {
    return extended.pglite.dataDir;
  }
  const cs = config.connectionString;
  if (typeof cs === "string" && (cs.startsWith("memory://") || cs.startsWith("idb://"))) {
    return cs;
  }
  return "memory://";
}

function pgliteOptionsFromPoolConfig(config?: PoolConfig): PGliteOptions {
  const extended = config as PoolConfig & { pglite?: PGliteOptions };
  return extended.pglite ?? {};
}

function normalizeParams<I extends any[]>(
  values?: import("pg").QueryConfigValues<I>
): unknown[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  return Array.isArray(values) ? [...values] : Object.values(values as Record<string, unknown>);
}

/**
 * Wraps a {@link PGliteInterface} so {@link import("pg").Pool#query} call sites can stay the same
 * as with `pg` (string + optional params, or {@link QueryConfig} with `text` / `values`).
 */
export class PGLitePool {
  readonly #db: PGliteInterface;

  constructor(PGliteCtor: typeof import("@electric-sql/pglite").PGlite, config?: PoolConfig) {
    const dataDir = dataDirFromPoolConfig(config);
    const opts = pgliteOptionsFromPoolConfig(config);
    this.#db = new PGliteCtor(dataDir, opts);
  }

  /** Resolve when WASM / FS initialization has finished. */
  async waitUntilReady(): Promise<void> {
    await this.#db.waitReady;
  }

  query<T extends Submittable>(queryStream: T): T;
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
    queryConfig: QueryConfig<I>
  ): Promise<QueryResult<R>>;
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: import("pg").QueryConfigValues<I>
  ): Promise<QueryResult<R>>;
  query(queryTextOrConfig: unknown, values?: unknown): unknown {
    if (
      queryTextOrConfig !== null &&
      typeof queryTextOrConfig === "object" &&
      "submit" in (queryTextOrConfig as object)
    ) {
      return queryTextOrConfig;
    }

    let text: string;
    let params: unknown[] | undefined;

    if (typeof queryTextOrConfig === "string") {
      text = queryTextOrConfig;
      params = normalizeParams(values as import("pg").QueryConfigValues<any>);
    } else {
      const cfg = queryTextOrConfig as QueryConfig<any>;
      if ("rowMode" in cfg && cfg.rowMode === "array") {
        throw new Error(
          'PGLitePool (browser): rowMode "array" is not supported; use default row objects.'
        );
      }
      text = cfg.text;
      params = normalizeParams(cfg.values as import("pg").QueryConfigValues<any>);
    }

    return this.#db.query(text, params).then((r) => toQueryResult(r as Results<QueryResultRow>));
  }

  async end(): Promise<void> {
    await this.#db.close();
  }
}

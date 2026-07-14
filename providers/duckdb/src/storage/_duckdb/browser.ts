/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Rows come back as plain records; result values are normalized JS values. */
export interface DuckDbQueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
}

const BROWSER_ERROR =
  "@workglow/duckdb/storage is not supported in the browser. DuckDB runs on Node.js and Bun via @duckdb/node-api.";

/**
 * Browser stub with the same shape as the Node/Bun handle. Every entry point
 * throws — DuckDB storage is a server-side backend (no duckdb-wasm wiring yet).
 */
export class DuckDbDatabase {
  private constructor() {}

  static async open(_path?: string): Promise<DuckDbDatabase> {
    throw new Error(BROWSER_ERROR);
  }

  async query<R = Record<string, unknown>>(
    _sql: string,
    _params?: readonly unknown[]
  ): Promise<DuckDbQueryResult<R>> {
    throw new Error(BROWSER_ERROR);
  }

  async exec(_sql: string): Promise<void> {
    throw new Error(BROWSER_ERROR);
  }

  close(): void {}
}

export const DuckDb = {
  init: async (): Promise<void> => {
    throw new Error(BROWSER_ERROR);
  },
  open: DuckDbDatabase.open,
  Database: DuckDbDatabase,
} as const;

/** Merged with {@link DuckDb} so `DuckDb.Database` works in type positions (not only as a value). */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DuckDb {
  export type Database = DuckDbDatabase;
}

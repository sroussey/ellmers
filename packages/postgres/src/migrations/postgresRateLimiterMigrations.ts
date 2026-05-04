/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool } from "../storage/_postgres/node-bun";
import type { PrefixColumn } from "@workglow/job-queue";
import {
  buildPrefixColumnsSql,
  getPrefixColumnNames,
  getPrefixIndexPrefix,
  getPrefixIndexSuffix,
  type IMigration,
  PostgresDialect,
} from "@workglow/storage";

/** Initial migration set for the Postgres rate-limiter tables. */
export function postgresRateLimiterMigrations(
  executionTableName: string,
  nextAvailableTableName: string,
  prefixes: readonly PrefixColumn[]
): IMigration<Pool>[] {
  const component = `rate-limiter:postgres:${executionTableName}`;
  const prefixColumnsSql = buildPrefixColumnsSql(PostgresDialect, prefixes);
  const prefixColumnNames = getPrefixColumnNames(prefixes);
  const prefixIndexPrefix = getPrefixIndexPrefix(prefixes);
  const indexSuffix = getPrefixIndexSuffix(prefixes);
  const primaryKeyColumns =
    prefixColumnNames.length > 0 ? `${prefixColumnNames.join(", ")}, queue_name` : "queue_name";

  return [
    {
      component,
      version: 1,
      description: "Create rate-limiter execution + next_available tables",
      async up(db: Pool) {
        await db.query(`
          CREATE TABLE IF NOT EXISTS ${executionTableName} (
            id SERIAL PRIMARY KEY,
            ${prefixColumnsSql}queue_name TEXT NOT NULL,
            executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `);
        await db.query(`
          CREATE INDEX IF NOT EXISTS rate_limit_exec_queue${indexSuffix}_idx
            ON ${executionTableName} (${prefixIndexPrefix}queue_name, executed_at)
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS ${nextAvailableTableName} (
            ${prefixColumnsSql}queue_name TEXT NOT NULL,
            next_available_at TIMESTAMP WITH TIME ZONE,
            PRIMARY KEY (${primaryKeyColumns})
          )
        `);
      },
    },
  ];
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool } from "../storage/_postgres/node-bun";
import { JobStatus, type PrefixColumn } from "@workglow/job-queue";
import {
  buildPrefixColumnsSql,
  getPrefixIndexPrefix,
  getPrefixIndexSuffix,
  type IMigration,
  PostgresDialect,
} from "@workglow/storage";

/**
 * Frozen v1 set of `job_status` enum values, captured at migration creation
 * time. Migration bodies are historical artifacts and MUST NOT read the
 * mutable {@link JobStatus} const directly: a fresh DB created after a value
 * is added to the const would receive the new value, while a DB already at v1
 * would not — silently producing version-skewed enums and runtime errors on
 * insert. Adding a status requires a NEW migration that runs
 * `ALTER TYPE job_status ADD VALUE IF NOT EXISTS '...'`.
 */
const JOB_STATUS_V1: readonly string[] = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "ABORTING",
  "FAILED",
  "DISABLED",
];

/**
 * Sanity check: if a developer adds a status to {@link JobStatus} without
 * also writing a follow-up migration that ALTER TYPE-adds it, queries that
 * insert the new status will fail at runtime against any DB still on v1.
 *
 * Run lazily from {@link postgresQueueMigrations} (NOT at module import) so
 * that consumers re-exporting this module via barrel files don't crash on
 * import when they have no intention of running migrations.
 */
function assertJobStatusMatchesV1(): void {
  const current = new Set(Object.values(JobStatus));
  for (const v of JOB_STATUS_V1) {
    if (!current.has(v as JobStatus)) {
      throw new Error(
        `JobStatus const is missing v1 enum value "${v}"; v1 migration values are frozen.`
      );
    }
  }
  for (const v of current) {
    if (!JOB_STATUS_V1.includes(v)) {
      throw new Error(
        `JobStatus contains "${v}" which is not in JOB_STATUS_V1. ` +
          `Add a new migration that runs "ALTER TYPE job_status ADD VALUE IF NOT EXISTS '${v}'" ` +
          `instead of mutating the v1 enum literal.`
      );
    }
  }
}

/**
 * Initial migration set for the Postgres queue table identified by `tableName`.
 *
 * Component name is `queue:postgres:<tableName>` so two queues with different
 * table names get tracked independently in `_storage_migrations`. The v1
 * payload covers schema + indexes + LISTEN/NOTIFY plumbing; the trigger is
 * idempotent (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS`).
 */
export function postgresQueueMigrations(
  tableName: string,
  prefixes: readonly PrefixColumn[]
): IMigration<Pool>[] {
  assertJobStatusMatchesV1();
  const component = `queue:postgres:${tableName}`;
  const prefixColumnsSql = buildPrefixColumnsSql(PostgresDialect, prefixes);
  const prefixIndexPrefix = getPrefixIndexPrefix(prefixes);
  const indexSuffix = getPrefixIndexSuffix(prefixes);

  return [
    {
      component,
      version: 1,
      description: "Create job_status enum + queue table + indexes + notify trigger",
      async up(db: Pool) {
        // Enum literal is the frozen v1 set, NOT Object.values(JobStatus).
        // See JOB_STATUS_V1 for why.
        const enumLiteral = JOB_STATUS_V1.map((v) => `'${v}'`).join(",");
        // DO block so the existence check + CREATE TYPE happen in one
        // statement. A bare `CREATE TYPE ...` raising duplicate_object inside
        // a transaction would leave it aborted (Postgres state 25P02), and
        // the runner's BEGIN/COMMIT would reject every subsequent statement.
        await db.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
              CREATE TYPE job_status AS ENUM (${enumLiteral});
            END IF;
          END $$;
        `);

        await db.query(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
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
          )
        `);

        await db.query(`
          CREATE INDEX IF NOT EXISTS job_fetcher${indexSuffix}_idx
            ON ${tableName} (${prefixIndexPrefix}id, status, run_after)
        `);
        await db.query(`
          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx
            ON ${tableName} (${prefixIndexPrefix}queue, status, run_after)
        `);
        await db.query(`
          CREATE INDEX IF NOT EXISTS jobs_fingerprint${indexSuffix}_unique_idx
            ON ${tableName} (${prefixIndexPrefix}queue, fingerprint, status)
        `);

        // Install LISTEN/NOTIFY plumbing so subscribers can wake on
        // INSERT/UPDATE without polling. Best-effort: in-process
        // Postgres-compatible engines like PGLite may not implement pg_notify
        // or plpgsql. Skip trigger installation in that case — the queue's
        // subscribeToChanges throws synchronously for those engines anyway.
        const fnName = `${tableName}_notify`;
        const trgName = `${tableName}_notify_trg`;
        try {
          await db.query(`
            CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $fn$
            DECLARE
              channel TEXT := 'wglw_q_' || md5('${tableName}' || COALESCE(NEW.queue, OLD.queue));
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
          await db.query(`DROP TRIGGER IF EXISTS ${trgName} ON ${tableName}`);
          await db.query(`
            CREATE TRIGGER ${trgName}
              AFTER INSERT OR UPDATE ON ${tableName}
              FOR EACH ROW EXECUTE FUNCTION ${fnName}();
          `);
        } catch {
          // Engine doesn't support LISTEN/NOTIFY; subscribers will fall back
          // to polling.
        }
      },
    },
  ];
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobStatus, type PrefixColumn } from "@workglow/job-queue";
import {
  buildPrefixColumnsSql,
  getPrefixIndexPrefix,
  getPrefixIndexSuffix,
  type IMigration,
  PostgresDialect,
} from "@workglow/storage";
import type { Pool } from "../storage/_postgres/node-bun";

/**
 * Migration set for the Postgres queue table identified by `tableName`.
 *
 * Component name is `queue:postgres:<tableName>` so two queues with different
 * table names get tracked independently in `_storage_migrations`. v1 creates
 * the canonical schema plus a UNIQUE partial fingerprint index used for
 * O(1) fingerprint dedup at the DB layer.
 */
export function postgresQueueMigrations(
  tableName: string,
  prefixes: readonly PrefixColumn[]
): IMigration<Pool>[] {
  const component = `queue:postgres:${tableName}`;
  const prefixColumnsSql = buildPrefixColumnsSql(PostgresDialect, prefixes);
  const prefixIndexPrefix = getPrefixIndexPrefix(prefixes);
  const indexSuffix = getPrefixIndexSuffix(prefixes);

  const enumLiteral = Object.values(JobStatus)
    .map((v) => `'${v}'`)
    .join(",");

  return [
    {
      component,
      version: 1,
      description: "Create job_status enum + queue table + indexes + notify trigger",
      async up(db: Pool) {
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
            attempts integer default 0,
            max_attempts integer default 10,
            visible_at timestamp with time zone DEFAULT now(),
            last_attempted_at timestamp with time zone,
            created_at timestamp with time zone DEFAULT now(),
            deadline_at timestamp with time zone,
            completed_at timestamp with time zone,
            error text,
            error_code text,
            progress real DEFAULT 0,
            progress_message text DEFAULT '',
            progress_details jsonb,
            lease_owner text,
            abort_requested_at timestamp with time zone,
            lease_expires_at timestamp with time zone
          )
        `);

        await db.query(`
          CREATE INDEX IF NOT EXISTS job_fetcher${indexSuffix}_idx
            ON ${tableName} (${prefixIndexPrefix}id, status, visible_at)
        `);
        await db.query(`
          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx
            ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at)
        `);
        await db.query(`
          CREATE INDEX IF NOT EXISTS jobs_fingerprint${indexSuffix}_unique_idx
            ON ${tableName} (${prefixIndexPrefix}queue, fingerprint, status)
        `);

        // UNIQUE partial index so concurrent send() calls with the same
        // fingerprint can race to INSERT and have the DB resolve the winner
        // via a 23505 unique-violation.
        await db.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_fingerprint_active
            ON ${tableName}(${prefixIndexPrefix}queue, fingerprint)
            WHERE status IN ('PENDING','PROCESSING')
        `);

        // Install LISTEN/NOTIFY plumbing so subscribers can wake on
        // INSERT/UPDATE without polling. Best-effort: in-process
        // Postgres-compatible engines like PGLite may not implement pg_notify
        // or plpgsql. Skip trigger installation in that case — the queue's
        // subscribeToChanges throws synchronously for those engines anyway.
        //
        // Wrapped in a SAVEPOINT because this migration runs inside the
        // runner's BEGIN/COMMIT. Without the savepoint, any error in the
        // trigger DDL would put the outer transaction into aborted state
        // (Postgres 25P02), poisoning the runner's bookkeeping INSERT.
        const fnName = `${tableName}_notify`;
        const trgName = `${tableName}_notify_trg`;
        await db.query("SAVEPOINT install_notify_trigger");
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
          await db.query("RELEASE SAVEPOINT install_notify_trigger");
        } catch {
          // Engine doesn't support LISTEN/NOTIFY; rewind to the savepoint so
          // the outer transaction stays usable, and let subscribers fall
          // back to polling.
          await db.query("ROLLBACK TO SAVEPOINT install_notify_trigger").catch(() => undefined);
          await db.query("RELEASE SAVEPOINT install_notify_trigger").catch(() => undefined);
        }
      },
    },
  ];
}

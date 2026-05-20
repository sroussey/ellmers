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
 * Frozen v1 set of `job_status` enum values, captured at migration creation
 * time. Migration bodies are historical artifacts and MUST NOT read the
 * mutable {@link JobStatus} const directly: a fresh DB created after a value
 * is added to the const would receive the new value, while a DB already at v1
 * would not — silently producing version-skewed enums and runtime errors on
 * insert. Adding a status requires a NEW migration that runs
 * `ALTER TYPE job_status ADD VALUE IF NOT EXISTS '...'`.
 *
 * ABORTING was present in v1 and removed from the application model in PR 2.
 * It remains in the v1 enum literal so existing databases are not broken;
 * the application simply no longer writes that value.
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
 * Sanity check: every current {@link JobStatus} value must be covered by the
 * v1 enum (or a subsequent ALTER TYPE migration). ABORTING was intentionally
 * removed from the application model; it is still legal in the DB schema but
 * we skip it here so the check does not reject a valid removal.
 *
 * Run lazily from {@link postgresQueueMigrations} (NOT at module import) so
 * that consumers re-exporting this module via barrel files don't crash on
 * import when they have no intention of running migrations.
 */
function assertJobStatusMatchesV1(): void {
  const current = new Set(Object.values(JobStatus));
  // Every current status must be present in the v1 enum (or added by a later migration).
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
 *
 * v1 is FROZEN byte-for-byte against the pre-PR shape — it MUST keep
 * creating the `run_after`/`run_attempts`/`max_retries`/`last_ran_at`/
 * `worker_id` columns and the corresponding `run_after`-keyed indexes.
 * Renames and index swaps live in v3 (with `IF EXISTS` guards so a fresh
 * install — which still goes through v1 — can apply v3 without errors).
 * Mutating v1 would silently produce divergent schemas between fresh and
 * already-migrated DBs and break older deployments mid-rollout.
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
        //
        // Wrapped in a SAVEPOINT because this migration runs inside the
        // runner's BEGIN/COMMIT. Without the savepoint, any error in the
        // trigger DDL would put the outer transaction into aborted state
        // (Postgres 25P02), poisoning the runner's bookkeeping INSERT and
        // failing the whole migration — even though the trigger itself is
        // optional. ROLLBACK TO SAVEPOINT lets us discard just the failed
        // trigger work and keep the rest of the migration committable.
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
    {
      component,
      version: 2,
      description: "Add abort_requested_at and lease_expires_at columns",
      async up(db: Pool) {
        await db.query(`
          ALTER TABLE ${tableName}
            ADD COLUMN IF NOT EXISTS abort_requested_at timestamp with time zone,
            ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone
        `);
      },
    },
    {
      component,
      version: 3,
      description:
        "Rename run_after→visible_at, last_ran_at→last_attempted_at, run_attempts→attempts, max_retries→max_attempts, worker_id→lease_owner; drop run_after-keyed indexes and recreate visible_at-keyed",
      async up(db: Pool) {
        // Each rename is guarded by IF EXISTS — fresh installs (which still
        // run v1 → v2 → v3) skip every branch and end up with the v1 schema
        // exactly. Existing installs from before this PR get renamed in place.
        await db.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='run_after' AND table_schema=current_schema()) THEN
              EXECUTE 'ALTER TABLE ${tableName} RENAME COLUMN run_after TO visible_at';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='last_ran_at' AND table_schema=current_schema()) THEN
              EXECUTE 'ALTER TABLE ${tableName} RENAME COLUMN last_ran_at TO last_attempted_at';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='run_attempts' AND table_schema=current_schema()) THEN
              EXECUTE 'ALTER TABLE ${tableName} RENAME COLUMN run_attempts TO attempts';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='max_retries' AND table_schema=current_schema()) THEN
              EXECUTE 'ALTER TABLE ${tableName} RENAME COLUMN max_retries TO max_attempts';
              EXECUTE 'ALTER TABLE ${tableName} ALTER COLUMN max_attempts SET DEFAULT 10';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='worker_id' AND table_schema=current_schema()) THEN
              EXECUTE 'ALTER TABLE ${tableName} RENAME COLUMN worker_id TO lease_owner';
            END IF;
          END $$
        `);

        // Drop the v1 run_after-keyed indexes and recreate them keyed on
        // visible_at. CREATE INDEX cannot be wrapped in CONCURRENTLY here
        // because the migration runs inside a transaction. The old indexes
        // are useless after the rename — PostgreSQL automatically retargets
        // them onto `visible_at` post-rename, but their NAMES still encode
        // the old column, which is confusing for operators and slot-binds
        // against the wrong stats; doing an explicit DROP + CREATE swap
        // keeps names and schemas consistent.
        await db.query(`DROP INDEX IF EXISTS job_fetcher${indexSuffix}_idx`);
        await db.query(`DROP INDEX IF EXISTS job_queue_fetcher${indexSuffix}_idx`);
        await db.query(`
          CREATE INDEX IF NOT EXISTS job_fetcher${indexSuffix}_idx
            ON ${tableName} (${prefixIndexPrefix}id, status, visible_at)
        `);
        await db.query(`
          CREATE INDEX IF NOT EXISTS job_queue_fetcher${indexSuffix}_idx
            ON ${tableName} (${prefixIndexPrefix}queue, status, visible_at)
        `);
      },
    },
    {
      component,
      version: 4,
      description:
        "Add UNIQUE partial index for findActiveByFingerprint O(1) lookup + fingerprint dedup at the DB layer (H2)",
      async up(db: Pool) {
        // H2: UNIQUE so concurrent send() calls with the same fingerprint can
        // race to INSERT and have the DB resolve the winner via a 23505 unique-
        // violation. The cloud-queue adapters used to optimistically check
        // findActiveByFingerprint then insert, leaving a TOCTOU window. With
        // UNIQUE in place, the insert path can catch the violation and
        // re-resolve via findActiveByFingerprint. Edited in place rather than
        // a v5 because PR #516 is still unmerged at the time of this fixup,
        // so no consumer has applied v4 yet — confirmed via PR state at the
        // top of the worktree session.
        await db.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_fingerprint_active
            ON ${tableName}(${prefixIndexPrefix}queue, fingerprint)
            WHERE status IN ('PENDING','PROCESSING')
        `);
      },
    },
    {
      component,
      version: 5,
      description:
        "Converge idx_<table>_fingerprint_active to UNIQUE for DBs that applied the pre-edit v4 (non-unique) variant",
      async up(db: Pool) {
        // PR #516 reviewers flagged that v4 was edited in place after some
        // pull-request consumers may already have applied the pre-edit
        // (non-unique) variant. The migration runner keys on (component,
        // version) alone, so an already-recorded v4 is never re-run — those
        // DBs would stay non-unique forever. v5 inspects the existing index
        // and converts it if needed, idempotently.
        const indexName = `idx_${tableName}_fingerprint_active`;
        const result = await db.query<{ indisunique: boolean }>(
          `SELECT i.indisunique
             FROM pg_class c
             JOIN pg_index i ON i.indexrelid = c.oid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = $1
              AND n.nspname = current_schema()`,
          [indexName]
        );
        const existing = result.rows[0];
        if (existing && existing.indisunique) {
          // Already UNIQUE — DB applied the post-edit v4 (or this v5 ran
          // previously). No-op.
          return;
        }
        // Either the index is missing entirely or it's the pre-edit
        // non-unique variant. Drop and recreate as UNIQUE. We use the same
        // canonical name so downstream code (PostgresQueueStorage,
        // SupabaseQueueStorage, the H2 race tests) keeps finding it by name.
        await db.query(`DROP INDEX IF EXISTS ${indexName}`);
        await db.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}
            ON ${tableName}(${prefixIndexPrefix}queue, fingerprint)
            WHERE status IN ('PENDING','PROCESSING')
        `);
      },
    },
  ];
}

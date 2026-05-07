# Unified Tabular Storage Migrations — Design

**Status:** Draft
**Date:** 2026-05-07
**Branch:** `claude/tabular-migrations-VJgmg`

## Background

The branch this work is based on (`6bcd1fa`, `9b9d301`, `bda7659`, `23847ea`,
`13dfe71`) introduced a real migration system in `@workglow/storage`:

- `IMigration<DB>` and `IMigrationRunner<DB>` in
  `packages/storage/src/migrations/`.
- Per-driver runners: `PostgresMigrationRunner`, `SqliteMigrationRunner`,
  `IndexedDbMigrationRunner`.
- A bookkeeping table `_storage_migrations` recording each successfully
  applied `(component, version)`.
- A contract conformance suite (`runMigrationRunnerContract`) that all three
  runners pass.

Today the system is wired up for **queue**, **rate-limiter**, and
**vector chunks** components. It is **not** wired up for tabular storage.

`ITabularStorage.setupDatabase()` derives DDL from the JSON Schema passed at
construction time and is idempotent (`CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, IndexedDB version bumps for new indexes). Its
docstring states explicitly: "Tabular schemas are derived from the JSON Schema
passed at construction rather than from versioned migrations, so this is the
schema-setup primitive — there is no `migrate()` to defer to."

That is fine for greenfield deployments but breaks down once a deployed schema
needs to evolve (rename a column, drop one, backfill a new one). In a
server-only stack we'd handle that with a separate migration tool. We can't,
because tabular storage runs in three places — server (Postgres/SQLite),
browser (IndexedDB), and ephemeral (InMemory/FsFolder/HuggingFace) — and we
need migrations that work uniformly across all of them.

## Goals

1. Let users author **one** migration definition that runs across SQLite,
   Postgres/Supabase, IndexedDB, and the schemaless backends.
2. Reuse the existing `IMigrationRunner<DB>` and `_storage_migrations`
   bookkeeping; do not introduce a parallel system.
3. Keep the JSON Schema as the **target** description; migrations describe how
   to evolve from older versions to the target.
4. Be opt-in. Existing tabular storages with no migrations declared continue
   to work unchanged.

## Non-goals (v1)

- **Down migrations.** Migrations are irreversible by contract; rollback is
  restore-from-backup.
- **Cross-component migrations.** A single migration definition touches a
  single tabular storage / component.
- **Online schema change for very large tables.** No `pt-osc`-style
  background copy; we accept a write lock during `ALTER`.
- **Auto-derived migrations from schema diffs.** Considered and rejected for
  v1 — too easy to silently produce a destructive operation.

## High-level model

The JSON Schema passed to a tabular storage's constructor is the **current
target**. A migration list is a separate, ordered sequence of declarative ops
that together evolve any prior version to the target.

A user adds a column by:

1. Updating the JSON Schema to include the new property.
2. Appending a migration with `addColumn` op for the same property.

Fresh DBs skip the migration list and create the table directly at the
target. Existing DBs run the missing migrations.

## Authoring surface

```ts
// New in @workglow/storage

export type TabularMigrationOp =
  | {
      readonly kind: "addColumn";
      readonly name: string;
      readonly schema: JsonSchema;
      readonly default?: JsonValue;
    }
  | { readonly kind: "dropColumn"; readonly name: string }
  | { readonly kind: "renameColumn"; readonly from: string; readonly to: string }
  | {
      readonly kind: "addIndex";
      readonly name: string;
      readonly columns: readonly string[];
      readonly unique?: boolean;
    }
  | { readonly kind: "dropIndex"; readonly name: string }
  | {
      readonly kind: "backfill";
      readonly batchSize?: number;
      readonly transform: (row: any, tx: AnyTabularStorage) =>
        | Promise<Record<string, unknown> | undefined>
        | Record<string, unknown>
        | undefined;
    };

export interface ITabularMigration {
  readonly component?: string; // defaults to `tabular:${storageName}`
  readonly version: number;
  readonly description?: string;
  readonly ops: ReadonlyArray<TabularMigrationOp>;
}
```

Constructor option:

```ts
new SqliteTabularStorage({
  name: "users",
  schema,
  primaryKeys: ["id"],
  migrations: [
    {
      version: 1,
      description: "add archived flag",
      ops: [
        { kind: "addColumn", name: "archived", schema: { type: "boolean", default: false } },
        { kind: "addIndex", name: "idx_archived", columns: ["archived"] },
      ],
    },
    {
      version: 2,
      description: "rename status -> state",
      ops: [{ kind: "renameColumn", from: "status", to: "state" }],
    },
    {
      version: 3,
      description: "backfill normalized email",
      ops: [
        { kind: "addColumn", name: "email_lower", schema: { type: "string" } },
        {
          kind: "backfill",
          batchSize: 500,
          transform: (row) => ({ ...row, email_lower: row.email?.toLowerCase() ?? null }),
        },
      ],
    },
  ],
});
```

### Versioning rules

Same contract as `IMigration`: `version` is a positive integer, monotonically
increasing per component, never reused or renumbered after release.

### Component naming

Defaults to `tabular:${name}` to match existing conventions
(`queue:job_queue_tenant`, `vector:chunks`). Users can override via
`migration.component` for namespacing in multi-tenant deployments.

### `backfill` semantics

- `transform` is invoked once per row in pages of `batchSize` rows
  (default 500).
- Iteration uses cursor-based `getPage` so it is stable under concurrent
  writes (in practice the migration holds a schema lock and there are no
  concurrent writes — but the cursor is correct regardless).
- Returning a new row writes via `tx.put`. Returning `undefined` deletes the
  row via `tx.delete`. Returning the row unchanged (referential equality with
  the input) is a no-op (skipped, no write).
- `tx` is the storage handle for the migration's transaction. On SQL
  backends this is the proxy returned by `withTransaction`; on IndexedDB it
  is the storage view bound to the upgrade transaction; on schemaless
  backends it is the storage itself.

### Atomicity

- **SQLite, Postgres, Supabase**: each migration's ops run inside a single
  `withTransaction`; on failure the transaction rolls back and the
  `_storage_migrations` row is not written.
- **IndexedDB**: each migration runs inside the single upgrade transaction
  IndexedDB requires for structural changes; same all-or-nothing semantics.
- **InMemory, FsFolder, HuggingFace, SharedInMemory**: best-effort. Partial
  application is possible on crash. Documented; user retry safe because the
  bookkeeping write is the last step of the migration.

## Architecture

### Layering

```
ITabularStorage (per-storage entry point)
        │
        │  setupDatabase()  ──── if migrations supplied
        ▼
TabularMigrationOrchestrator   (new, in @workglow/storage)
        │
        │  for each pending tabular migration:
        │    storage.translateOps(ops)  →  IMigration<DB>
        ▼
IMigrationRunner<DB>           (existing, per-driver)
        │
        ▼
_storage_migrations            (existing bookkeeping)
```

The orchestrator does **not** add a new bookkeeping path. It composes the
existing per-driver `IMigrationRunner<DB>` so concurrency, failure semantics,
and progress events all flow through the already-tested infrastructure.

### Per-storage `translateOps`

Each tabular backend implements:

```ts
// Conceptual; exact shape adapts per backend.
abstract class BaseTabularStorage<...> {
  protected abstract translateOps(
    component: string,
    version: number,
    ops: ReadonlyArray<TabularMigrationOp>
  ): IMigration<DB>;
}
```

This puts the knowledge of "what does `addColumn` mean for this backend"
adjacent to the storage that owns it.

#### SQL backends (SQLite, Postgres, Supabase)

Implemented once on `BaseSqlTabularStorage` since both dialects expose the
same surface via the existing `Dialect` abstraction:

- `addColumn` → `ALTER TABLE … ADD COLUMN <col> <type> [DEFAULT …]` via
  `Dialect.columnDefinition`.
- `dropColumn` → `ALTER TABLE … DROP COLUMN <col>`. Postgres: native.
  SQLite ≥ 3.35: native. Older SQLite: dialect emits the standard
  table-rebuild dance.
- `renameColumn` → `ALTER TABLE … RENAME COLUMN`. Native on both current
  dialects.
- `addIndex` → `CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name> ON <table>(<cols>)`.
- `dropIndex` → `DROP INDEX [IF EXISTS] <name>`.
- `backfill` → iterates `tx.getPage(...)` in batches and applies
  `tx.put`/`tx.delete`.

The shared SQL builder added in `6bcd1fa` is reused for column definitions
and index DDL.

#### IndexedDB

`IndexedDbTabularStorage.translateOps` builds an `IMigration<IDBDatabase>`
whose `up()` runs inside the upgrade transaction provided by
`IndexedDbMigrationRunner`:

- `addColumn` / `dropColumn` / `renameColumn` → no-ops on the object store
  (records are plain JS objects; no schema enforcement). Backfills handle the
  data side when needed.
- `addIndex` → `objectStore.createIndex(name, columns, { unique })`.
- `dropIndex` → `objectStore.deleteIndex(name)`.
- `backfill` → cursor-iterates the object store inside the upgrade
  transaction; rewrites in place.

The orchestrator groups all pending tabular ops + bookkeeping write into a
single version bump per `(dbName, component)` to avoid the open-version
deadlock the IDB runner already guards against (`73a086c`).

#### InMemory, FsFolder, SharedInMemory, HuggingFace (schemaless)

DDL ops are no-ops (records are plain JS objects). `backfill` runs through
the standard `getPage`/`put`/`delete` loop. Bookkeeping is recorded so that:

- Two processes pointing at the same FsFolder agree on applied versions.
- Data exported from InMemory and imported into Postgres carries an applied-
  versions hint and the SQL backend skips already-applied migrations.

#### Cached / Telemetry wrappers

Delegate `setupDatabase` and the `migrations` constructor option straight
through to the inner storage. No new logic.

## `setupDatabase()` integration

```
setupDatabase() {
  if (no migrations supplied) {
    // existing behavior, unchanged:
    //   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, IDB version bump
    return;
  }

  ensureBookkeepingTable();
  applied = appliedVersions(component);

  if (applied is empty AND table does not exist) {
    // FRESH-DB FAST PATH (single transaction)
    CREATE TABLE / object store from target schema;
    INSERT one bookkeeping row per declared migration (as already-applied);
    return;
  }

  // EXISTING-DB PATH
  pending = migrations.filter(m => !applied.has(m.version)).sortBy(version);
  for each m in pending:
    impl = this.translateOps(component, m.version, m.ops);
    runner.run([impl]); // existing runner handles tx + bookkeeping write + events
}
```

Notes:

- The "table does not exist" probe is a backend-specific cheap check (e.g.
  `SELECT 1 FROM <table> LIMIT 0` for SQL, `objectStoreNames.contains` for
  IDB, registry lookup for InMemory).
- The fresh-DB fast path is critical: it avoids running expensive backfills
  against a brand-new DB.
- The orchestrator, the runner, and the bookkeeping write share a single
  transaction per migration on backends with native transactions.

## Bookkeeping

Reuse `_storage_migrations` exactly as defined today. No schema change.

- Component default: `tabular:${storageName}`.
- `MigrationProgressEvent.component` is forwarded as-is so subscribers can
  filter on `tabular:*` if they want.

Schemaless backends keep an in-memory or in-file `_storage_migrations`
representation (Map for InMemory, JSON file for FsFolder).

## Concurrency

Inherited from the existing per-driver runners — no new logic:

- **Postgres**: advisory lock during `run()`.
- **SQLite**: per-instance mutex (`6aa0928`).
- **IndexedDB**: per-`dbName` serialization (`73a086c`).
- **Schemaless**: not safe across processes; user-level concern.

## Failure semantics

Same as existing runner:

- A failed `up()` emits a `failed` `MigrationProgressEvent` with the thrown
  error and rethrows.
- Bookkeeping for that version is **not** written.
- Subsequent calls retry from the failed version.
- On SQL backends the entire migration (DDL + backfill) rolls back atomically
  inside its `withTransaction`. The `failedMigrationLeavesNoPartialSchema`
  test (`13dfe71`) is extended to cover tabular ops.

## Drift detection (opt-in)

A debug-time `validateSchema` flag (default off) re-introspects the live DB
schema after migrations run and compares it to the target JSON Schema.
Mismatches throw `TabularMigrationDriftError`.

Off by default because:

- Some backends (Supabase, HuggingFace) don't introspect cleanly.
- Startup-hostile in production.
- Useful in dev / CI to catch schema-vs-migration drift early.

## Adoption

Existing tabular storages don't pass `migrations`; behavior unchanged. To
adopt:

1. Add `migrations: []` to the constructor (declares "I'm tracking
   migrations now"). On a fresh DB this writes no bookkeeping rows; on an
   existing DB this also writes none, leaving the system in a "no
   migrations applied yet" baseline.
2. The first real schema change appends a migration with `version: 1`.

There is **no** automatic backfill of pre-existing schemas into a v0
migration. Storages that opt in start with an empty applied-set; their first
declared migration is `version: 1` and runs whether the table existed before
or not. Authors are responsible for making `version: 1` idempotent or
guarding it against pre-existing state if they need to support both fresh
deployments and already-deployed schemas during the transition window.
(For most callers this means writing `addColumn`/`addIndex` ops with
`IF NOT EXISTS` semantics, which is what the SQL translator already emits.)

## Testing

Mirror the existing migration contract suite:

- New `runTabularMigrationContract(makeStorage)` shared in
  `@workglow/test`, exercising all op kinds against any tabular backend.
- Per-backend integration tests under
  `packages/test/src/test/tabular-migrations/` for SQLite, Postgres,
  Supabase, IndexedDB, InMemory, FsFolder.
- Existing concurrency tests
  (`concurrentRunsSerialize`, `failedMigrationLeavesNoPartialSchema`) get
  parallel tabular-flavored versions.

## Open questions resolved during brainstorming

- **Authoring model:** declarative diff ops (not per-backend `up()`).
- **Schema relationship:** schema is the target; migrations fill the gap.
- **Op coverage v1:** addColumn, dropColumn, renameColumn, addIndex,
  dropIndex, backfill.
- **Where migrations live:** per-storage constructor option.
- **Schemaless backends:** DDL ops no-op; backfills run; bookkeeping
  recorded.
- **Adoption:** opt-in; no migrations supplied = unchanged behavior.

## Risks

- **IDB upgrade-transaction scope.** Backfills inside `onupgradeneeded` are
  rare in the wild; we'll need integration tests against both Chromium- and
  WebKit-based IDB to confirm cursor iteration + writes behave as expected.
- **SQLite older-version `dropColumn`.** Table-rebuild dance is not
  transactional in the same way; we may need to gate it on engine version
  and document a fallback.
- **`backfill` semantics on best-effort backends.** An InMemory crash mid-
  backfill is recoverable only because the bookkeeping write is last; users
  who care about durability should not use these backends in prod (which is
  already true).
- **Interaction with `withTransaction` proxy semantics on Postgres real-pool
  path.** The proxy added in `cad033c` must propagate through `tx.getPage`
  during backfills; covered by integration tests.

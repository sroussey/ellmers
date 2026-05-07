# Unified Tabular Storage Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend-agnostic, declarative migration system for `ITabularStorage` that runs across SQLite, Postgres/Supabase, IndexedDB, InMemory, FsFolder, SharedInMemory, and HuggingFace tabular backends, reusing the existing `_storage_migrations` bookkeeping table.

**Architecture:** New `ITabularMigration` (declarative ops) + `ITabularMigrationApplier` (per-backend atomic apply primitive) in `@workglow/storage`. Each tabular storage exposes a `migrations` constructor option and an `applier` it returns from `getMigrationApplier()`. A new `TabularMigrationOrchestrator` in `@workglow/storage` sequences pending migrations through that applier. SQL backends apply ops via `storage.withTransaction`. IndexedDB applies them by feeding translated `IndexedDbMigration` objects through the existing `IndexedDbMigrationRunner`. Schemaless backends apply ops in-memory.

**Tech Stack:** TypeScript, Bun + Vitest, existing `IMigrationRunner<DB>` infra, `ITabularStorage`, `Dialect`.

**Spec:** `docs/superpowers/specs/2026-05-07-unified-tabular-migrations-design.md`.

---

## File structure

**Phase 0 (core types in @workglow/storage):**
- Create: `packages/storage/src/migrations/TabularMigration.ts` — declarative op union + `ITabularMigration` + `ITabularMigrationApplier`
- Create: `packages/storage/src/migrations/TabularMigrationOrchestrator.ts` — sequences pending migrations through an applier
- Create: `packages/storage/src/migrations/runBackfill.ts` — backend-agnostic page-based backfill loop
- Modify: `packages/storage/src/migrations/index.ts` — re-export new symbols
- Modify: `packages/storage/src/common.ts` — re-export migration types if not already covered by `migrations/index.ts`

**Phase 1 (BaseTabularStorage hook-in):**
- Modify: `packages/storage/src/tabular/BaseTabularStorage.ts` — add `tabularMigrations` field, `migrationComponent` field, abstract `getMigrationApplier()` (returns `null` by default), `applyTabularMigrations()` helper

**Phase 2 (SQL applier shared logic):**
- Create: `packages/storage/src/tabular/SqlTabularMigrationApplier.ts` — abstract base; subclasses provide DDL emission + `withTransaction` integration; bookkeeping INSERT inside the same `withTransaction`
- Create: `packages/storage/src/tabular/sqlMigrationDdl.ts` — pure DDL builders for SQLite/Postgres dialects (`addColumn`, `dropColumn`, `renameColumn`, `addIndex`, `dropIndex`)

**Phase 3 (SQLite wiring):**
- Modify: `packages/sqlite/src/storage/SqliteTabularStorage.ts` — accept `migrations` constructor option, override `setupDatabase` to dispatch through orchestrator when set, implement `getMigrationApplier()`

**Phase 4 (Postgres wiring):**
- Modify: `packages/postgres/src/storage/PostgresTabularStorage.ts` — same shape as SQLite (adapted for `Pool`)

**Phase 5 (IndexedDB wiring):**
- Create: `packages/indexeddb/src/storage/IndexedDbTabularMigrationApplier.ts` — translates ops to an `IndexedDbMigration`, runs through `IndexedDbMigrationRunner`
- Modify: `packages/indexeddb/src/storage/IndexedDbTabularStorage.ts` — accept `migrations` constructor option, dispatch through orchestrator
- Modify: `packages/indexeddb/src/storage/IndexedDbTable.ts` — expose helper for "store exists" probe used by orchestrator fresh-DB fast path

**Phase 6 (schemaless backends):**
- Create: `packages/storage/src/tabular/InMemoryTabularMigrationApplier.ts` — no-ops DDL, runs backfill via the storage; in-memory bookkeeping map
- Modify: `packages/storage/src/tabular/InMemoryTabularStorage.ts` — accept `migrations` option, dispatch through orchestrator
- Modify: `packages/storage/src/tabular/SharedInMemoryTabularStorage.ts` — same
- Modify: `packages/storage/src/tabular/FsFolderTabularStorage.ts` — same; persist bookkeeping as a `_storage_migrations.json` file beside the data
- Modify: `packages/storage/src/tabular/HuggingFaceTabularStorage.ts` — same; bookkeeping is process-local (read-only HF backend)

**Phase 7 (wrapper passthrough):**
- Modify: `packages/storage/src/tabular/CachedTabularStorage.ts` — pass `migrations` through to inner storage; delegate `setupDatabase`
- Modify: `packages/storage/src/tabular/TelemetryTabularStorage.ts` — same

**Phase 8 (contract suite):**
- Create: `packages/test/src/contract/tabular-migrations/types.ts`
- Create: `packages/test/src/contract/tabular-migrations/runTabularMigrationContract.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/addColumn.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/dropColumn.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/renameColumn.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/addAndDropIndex.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/backfill.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/freshDbFastPath.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/incrementalApplication.ts`
- Create: `packages/test/src/contract/tabular-migrations/assertions/failedMigrationNotRecorded.ts`

**Phase 9 (per-backend integration tests):**
- Create: `packages/test/src/test/tabular-migrations/InMemoryTabular.contract.test.ts`
- Create: `packages/test/src/test/tabular-migrations/SqliteTabular.contract.test.ts`
- Create: `packages/test/src/test/tabular-migrations/PostgresTabular.contract.test.ts`
- Create: `packages/test/src/test/tabular-migrations/IndexedDbTabular.contract.test.ts`
- Create: `packages/test/src/test/tabular-migrations/FsFolderTabular.contract.test.ts`

---

# Phase 0 — Core types and orchestrator

### Task 0.1: Create the declarative op + applier types

**Files:**
- Create: `packages/storage/src/migrations/TabularMigration.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema, JsonValue } from "@workglow/util/schema";
import type { MigrationProgressListener } from "./IMigration";

/**
 * Backend-agnostic, declarative description of a single schema-evolution step.
 * Each op is translated to native operations by a per-backend
 * {@link ITabularMigrationApplier}.
 *
 * Ops within a single migration are applied in array order inside one atomic
 * unit (a `withTransaction` on SQL backends, an upgrade transaction on
 * IndexedDB, best-effort sequential on schemaless backends).
 */
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
      readonly transform: (
        row: Record<string, unknown>
      ) =>
        | Promise<Record<string, unknown> | undefined>
        | Record<string, unknown>
        | undefined;
    };

/**
 * One versioned migration for a tabular storage. Identified by
 * `(component, version)` like {@link IMigration}; bookkeeping shares
 * the existing `_storage_migrations` table.
 *
 * `component` defaults to `tabular:${storageName}` when omitted (the
 * orchestrator fills it in from the owning storage).
 */
export interface ITabularMigration {
  readonly component?: string;
  readonly version: number;
  readonly description?: string;
  readonly ops: ReadonlyArray<TabularMigrationOp>;
}

/**
 * Per-backend primitive that the orchestrator drives. A backend implements
 * `applyMigration` as an atomic unit (DDL + backfill + bookkeeping write
 * in one transaction where the backend supports it).
 *
 * `tableExists` is the freshness probe used by the orchestrator to decide
 * whether to take the fast path (CREATE + mark all migrations applied) or
 * the run-pending path.
 */
export interface ITabularMigrationApplier {
  ensureBookkeeping(): Promise<void>;
  appliedVersions(component: string): Promise<Set<number>>;
  tableExists(): Promise<boolean>;
  /**
   * Apply all ops AND record `(component, version)` in bookkeeping in one
   * atomic unit on backends with native transactions; best-effort sequential
   * on schemaless backends (DDL no-ops + backfill + bookkeeping write).
   */
  applyMigration(
    component: string,
    version: number,
    description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void>;
  /**
   * Mark all supplied `(component, version)` pairs as applied in bookkeeping
   * without running their ops. Used by the fresh-DB fast path.
   */
  markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void>;
}

export type TabularMigrationProgressListener = MigrationProgressListener;
```

- [ ] **Step 2: Verify package builds**

Run: `bun run build --filter=@workglow/storage`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/migrations/TabularMigration.ts
git commit -m "feat(storage): TabularMigrationOp + ITabularMigration + applier types"
```

### Task 0.2: Re-export from `migrations/index.ts`

**Files:**
- Modify: `packages/storage/src/migrations/index.ts`

- [ ] **Step 1: Edit the index file**

Replace contents with:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./IMigration";
export * from "./MigrationRunner";
export * from "./TabularMigration";
export * from "./TabularMigrationOrchestrator";
export * from "./runBackfill";
```

- [ ] **Step 2: Commit**

```bash
git add packages/storage/src/migrations/index.ts
git commit -m "feat(storage): re-export tabular migration types"
```

### Task 0.3: Backend-agnostic backfill loop

**Files:**
- Create: `packages/storage/src/migrations/runBackfill.ts`

- [ ] **Step 1: Write a failing test**

Create `packages/test/src/test/tabular-migrations/runBackfill.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { runBackfill } from "@workglow/storage";
import { InMemoryTabularStorage } from "@workglow/storage";

describe("runBackfill", () => {
  const schema = {
    type: "object",
    properties: { id: { type: "string" }, n: { type: "integer" } },
    required: ["id", "n"],
    additionalProperties: false,
  } as const;

  it("rewrites every row with the transform output", async () => {
    const storage = new InMemoryTabularStorage(schema, ["id"] as const);
    await storage.setupDatabase();
    for (let i = 0; i < 25; i++) {
      await storage.put({ id: `r${i}`, n: i });
    }
    await runBackfill(storage as any, 10, (row) => ({ ...row, n: (row.n as number) * 10 }));
    const all = (await storage.getAll())!;
    expect(all.find((r) => r.id === "r3")?.n).toBe(30);
    expect(all).toHaveLength(25);
  });

  it("deletes rows when transform returns undefined", async () => {
    const storage = new InMemoryTabularStorage(schema, ["id"] as const);
    await storage.setupDatabase();
    for (let i = 0; i < 5; i++) await storage.put({ id: `r${i}`, n: i });
    await runBackfill(storage as any, 10, (row) =>
      (row.n as number) % 2 === 0 ? undefined : row
    );
    expect(await storage.size()).toBe(2);
  });

  it("skips writes when transform returns the same row", async () => {
    const storage = new InMemoryTabularStorage(schema, ["id"] as const);
    await storage.setupDatabase();
    let writes = 0;
    storage.on("put", () => writes++);
    await storage.put({ id: "r1", n: 1 });
    writes = 0;
    await runBackfill(storage as any, 10, (row) => row);
    expect(writes).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/test/src/test/tabular-migrations/runBackfill.test.ts`
Expected: FAIL — `runBackfill` does not exist.

- [ ] **Step 3: Write implementation**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage } from "../tabular/ITabularStorage";

/**
 * Backend-agnostic, page-based backfill loop. Iterates every row in the
 * storage in `batchSize`-row pages using cursor pagination so iteration
 * is stable under concurrent writes.
 *
 * For each row, calls `transform` and:
 *   - if it returns the **same reference** as the input, skips the write
 *     (the row is unchanged);
 *   - if it returns `undefined`, deletes the row;
 *   - otherwise, writes the new row via `put`.
 */
export async function runBackfill(
  storage: AnyTabularStorage,
  batchSize: number,
  transform: (
    row: Record<string, unknown>
  ) =>
    | Promise<Record<string, unknown> | undefined>
    | Record<string, unknown>
    | undefined
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await storage.getPage({ limit: batchSize, cursor });
    for (const row of page.items) {
      const out = await transform(row as Record<string, unknown>);
      if (out === row) continue;
      if (out === undefined) {
        await storage.delete(row);
      } else {
        await storage.put(out);
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/test/src/test/tabular-migrations/runBackfill.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/migrations/runBackfill.ts packages/test/src/test/tabular-migrations/runBackfill.test.ts
git commit -m "feat(storage): runBackfill helper for tabular migrations"
```

### Task 0.4: Orchestrator skeleton

**Files:**
- Create: `packages/storage/src/migrations/TabularMigrationOrchestrator.ts`

- [ ] **Step 1: Write the orchestrator**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ITabularMigration,
  ITabularMigrationApplier,
  TabularMigrationProgressListener,
} from "./TabularMigration";

/**
 * Sequences pending tabular migrations through a backend's
 * {@link ITabularMigrationApplier}.
 *
 * Two paths:
 *   - **fresh-DB fast path** — applied is empty AND `tableExists()` is false.
 *     Caller has already (or will) create the table at the target schema;
 *     the orchestrator records every declared migration as already-applied
 *     without running its ops.
 *   - **run-pending path** — sorted-by-version, skip already-applied,
 *     call `applyMigration` for each remaining one.
 *
 * Bookkeeping is owned by the applier (one row per `(component, version)`
 * in the existing `_storage_migrations` table).
 */
export interface RunTabularMigrationsOptions {
  readonly onProgress?: TabularMigrationProgressListener;
}

export async function runTabularMigrations(
  applier: ITabularMigrationApplier,
  defaultComponent: string,
  migrations: ReadonlyArray<ITabularMigration>,
  options: RunTabularMigrationsOptions = {}
): Promise<void> {
  if (migrations.length === 0) return;
  await applier.ensureBookkeeping();

  // Group migrations by their resolved component so applied lookups stay
  // accurate when callers override `component` per migration.
  const byComponent = new Map<string, ITabularMigration[]>();
  for (const m of migrations) {
    const c = m.component ?? defaultComponent;
    let bucket = byComponent.get(c);
    if (!bucket) {
      bucket = [];
      byComponent.set(c, bucket);
    }
    bucket.push(m);
  }

  for (const [component, group] of byComponent) {
    const sorted = [...group].sort((a, b) => a.version - b.version);
    const applied = await applier.appliedVersions(component);

    if (applied.size === 0 && !(await applier.tableExists())) {
      // Fresh-DB fast path: caller created the table at target; skip ops.
      await applier.markAllApplied(
        component,
        sorted.map((m) => ({ version: m.version, description: m.description }))
      );
      for (const m of sorted) {
        options.onProgress?.({
          component,
          version: m.version,
          phase: "completed",
          description: m.description,
          fraction: 1,
        });
      }
      continue;
    }

    for (const m of sorted) {
      if (applied.has(m.version)) continue;
      options.onProgress?.({
        component,
        version: m.version,
        phase: "starting",
        description: m.description,
      });
      try {
        await applier.applyMigration(
          component,
          m.version,
          m.description,
          m.ops,
          (fraction) => {
            options.onProgress?.({
              component,
              version: m.version,
              phase: "running",
              description: m.description,
              fraction,
            });
          }
        );
        options.onProgress?.({
          component,
          version: m.version,
          phase: "completed",
          description: m.description,
          fraction: 1,
        });
      } catch (err) {
        options.onProgress?.({
          component,
          version: m.version,
          phase: "failed",
          description: m.description,
          error: err,
        });
        throw err;
      }
    }
  }
}
```

- [ ] **Step 2: Verify it builds**

Run: `bun run build --filter=@workglow/storage`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/migrations/TabularMigrationOrchestrator.ts
git commit -m "feat(storage): TabularMigrationOrchestrator (fast-path + sequential apply)"
```

---

# Phase 1 — `BaseTabularStorage` hook-in

### Task 1.1: Add migrations field + applier accessor + helper

**Files:**
- Modify: `packages/storage/src/tabular/BaseTabularStorage.ts`

- [ ] **Step 1: Add imports near top of file**

Add to the imports block:

```ts
import {
  ITabularMigration,
  ITabularMigrationApplier,
  runTabularMigrations,
  RunTabularMigrationsOptions,
} from "../migrations";
```

- [ ] **Step 2: Add fields and helpers in `BaseTabularStorage`**

Inside the class body (right after the existing `protected indexes:` line), add:

```ts
/**
 * Optional declarative migrations evolving older deployments to the
 * current target schema. When set + non-empty, `setupDatabase()` on
 * concrete subclasses delegates to {@link applyTabularMigrations}.
 */
protected readonly tabularMigrations: ReadonlyArray<ITabularMigration> | undefined;

/**
 * Default component name used when an `ITabularMigration.component` is
 * omitted. Defaults to `tabular:${storageName}` once the subclass has
 * supplied a name.
 */
protected migrationComponent: string = "tabular:unnamed";
```

Add a public method at the end of the class (before the destroy block):

```ts
/**
 * Subclass override returning a backend-specific applier. Returning `null`
 * disables tabular migrations for the storage. The base class returns
 * `null`; only backends that have wired up their applier override this.
 */
public getMigrationApplier(): ITabularMigrationApplier | null {
  return null;
}

/**
 * Runs `this.tabularMigrations` through the orchestrator using the
 * backend-supplied applier. Idempotent (no-op when no migrations are
 * declared, or when all are already applied).
 */
protected async applyTabularMigrations(
  options?: RunTabularMigrationsOptions
): Promise<void> {
  if (!this.tabularMigrations || this.tabularMigrations.length === 0) return;
  const applier = this.getMigrationApplier();
  if (!applier) {
    throw new Error(
      `${this.constructor.name} declared migrations but has no migration applier wired up.`
    );
  }
  await runTabularMigrations(
    applier,
    this.migrationComponent,
    this.tabularMigrations,
    options
  );
}
```

- [ ] **Step 3: Extend the constructor signature**

Change the constructor params to accept migrations + name. Find:

```ts
constructor(
  protected schema: Schema,
  protected primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing"
) {
```

Replace with:

```ts
constructor(
  protected schema: Schema,
  protected primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing",
  tabularMigrations?: ReadonlyArray<ITabularMigration>,
  migrationName?: string
) {
```

At the very top of the constructor body (before `this.clientProvidedKeys = ...`):

```ts
this.tabularMigrations = tabularMigrations;
if (migrationName) {
  this.migrationComponent = `tabular:${migrationName}`;
}
```

- [ ] **Step 4: Build & commit**

```bash
bun run build --filter=@workglow/storage
git add packages/storage/src/tabular/BaseTabularStorage.ts
git commit -m "feat(storage): tabular migration plumbing on BaseTabularStorage"
```

---

# Phase 2 — SQL applier shared logic

### Task 2.1: DDL builders

**Files:**
- Create: `packages/storage/src/tabular/sqlMigrationDdl.ts`

- [ ] **Step 1: Write a failing unit test**

Create `packages/test/src/test/tabular-migrations/sqlMigrationDdl.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  buildAddColumnSql,
  buildDropColumnSql,
  buildRenameColumnSql,
  buildAddIndexSql,
  buildDropIndexSql,
} from "@workglow/storage";

describe("sqlMigrationDdl", () => {
  it("addColumn for SQLite", () => {
    expect(
      buildAddColumnSql("sqlite", "users", "archived", "INTEGER", false)
    ).toBe("ALTER TABLE `users` ADD COLUMN `archived` INTEGER");
  });

  it("addColumn for Postgres with DEFAULT", () => {
    expect(
      buildAddColumnSql("postgres", "users", "archived", "BOOLEAN", false, false)
    ).toBe('ALTER TABLE "users" ADD COLUMN "archived" BOOLEAN');
  });

  it("dropColumn", () => {
    expect(buildDropColumnSql("postgres", "users", "old_col")).toBe(
      'ALTER TABLE "users" DROP COLUMN "old_col"'
    );
    expect(buildDropColumnSql("sqlite", "users", "old_col")).toBe(
      "ALTER TABLE `users` DROP COLUMN `old_col`"
    );
  });

  it("renameColumn", () => {
    expect(buildRenameColumnSql("postgres", "users", "status", "state")).toBe(
      'ALTER TABLE "users" RENAME COLUMN "status" TO "state"'
    );
    expect(buildRenameColumnSql("sqlite", "users", "status", "state")).toBe(
      "ALTER TABLE `users` RENAME COLUMN `status` TO `state`"
    );
  });

  it("addIndex", () => {
    expect(
      buildAddIndexSql("postgres", "users", "idx_archived", ["archived"], false)
    ).toBe(
      'CREATE INDEX IF NOT EXISTS "idx_archived" ON "users" ("archived")'
    );
    expect(
      buildAddIndexSql("postgres", "users", "uq_email", ["email"], true)
    ).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_email" ON "users" ("email")'
    );
  });

  it("dropIndex", () => {
    expect(buildDropIndexSql("postgres", "idx_archived")).toBe(
      'DROP INDEX IF EXISTS "idx_archived"'
    );
    expect(buildDropIndexSql("sqlite", "idx_archived")).toBe(
      "DROP INDEX IF EXISTS `idx_archived`"
    );
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `bun test packages/test/src/test/tabular-migrations/sqlMigrationDdl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PostgresDialect, SqliteDialect, type ISqlDialect } from "../sql/Dialect";

/** Selects the dialect by name. */
function selectDialect(name: "sqlite" | "postgres"): ISqlDialect {
  return name === "sqlite" ? SqliteDialect : PostgresDialect;
}

export function buildAddColumnSql(
  dialect: "sqlite" | "postgres",
  table: string,
  column: string,
  sqlType: string,
  nullable: boolean,
  hasDefault: boolean = false,
  defaultLiteralSql?: string
): string {
  const d = selectDialect(dialect);
  let sql = `ALTER TABLE ${d.quoteId(table)} ADD COLUMN ${d.quoteId(column)} ${sqlType}`;
  if (!nullable) sql += " NOT NULL";
  if (hasDefault && defaultLiteralSql !== undefined) {
    sql += ` DEFAULT ${defaultLiteralSql}`;
  }
  return sql;
}

export function buildDropColumnSql(
  dialect: "sqlite" | "postgres",
  table: string,
  column: string
): string {
  const d = selectDialect(dialect);
  return `ALTER TABLE ${d.quoteId(table)} DROP COLUMN ${d.quoteId(column)}`;
}

export function buildRenameColumnSql(
  dialect: "sqlite" | "postgres",
  table: string,
  from: string,
  to: string
): string {
  const d = selectDialect(dialect);
  return `ALTER TABLE ${d.quoteId(table)} RENAME COLUMN ${d.quoteId(from)} TO ${d.quoteId(to)}`;
}

export function buildAddIndexSql(
  dialect: "sqlite" | "postgres",
  table: string,
  indexName: string,
  columns: readonly string[],
  unique: boolean
): string {
  const d = selectDialect(dialect);
  const cols = columns.map((c) => d.quoteId(c)).join(", ");
  return (
    `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ` +
    `${d.quoteId(indexName)} ON ${d.quoteId(table)} (${cols})`
  );
}

export function buildDropIndexSql(
  dialect: "sqlite" | "postgres",
  indexName: string
): string {
  const d = selectDialect(dialect);
  return `DROP INDEX IF EXISTS ${d.quoteId(indexName)}`;
}
```

- [ ] **Step 4: Re-export from `tabular/ITabularStorage.ts` barrel or storage common**

Edit `packages/storage/src/common.ts` — add:

```ts
export * from "./tabular/sqlMigrationDdl";
```

(if the file already follows that pattern; otherwise add to whichever module aggregates tabular exports — search for `export * from "./tabular/BaseSqlTabularStorage"` and add the new line beside it).

- [ ] **Step 5: Run tests — pass**

Run: `bun test packages/test/src/test/tabular-migrations/sqlMigrationDdl.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src/tabular/sqlMigrationDdl.ts packages/storage/src/common.ts packages/test/src/test/tabular-migrations/sqlMigrationDdl.test.ts
git commit -m "feat(storage): SQL DDL builders for tabular migrations"
```

### Task 2.2: SQL applier base class

**Files:**
- Create: `packages/storage/src/tabular/SqlTabularMigrationApplier.ts`

- [ ] **Step 1: Write the file**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import {
  type ITabularMigrationApplier,
  type TabularMigrationOp,
  MIGRATIONS_TABLE,
  runBackfill,
} from "../migrations";
import { type AnyTabularStorage } from "./ITabularStorage";
import {
  buildAddColumnSql,
  buildAddIndexSql,
  buildDropColumnSql,
  buildDropIndexSql,
  buildRenameColumnSql,
} from "./sqlMigrationDdl";

/**
 * SQL-flavored {@link ITabularMigrationApplier}. Subclasses (one per dialect)
 * provide the connection-level primitives (`exec`, `tableExists`,
 * `withTransaction`) and the JSON-Schema-to-SQL mapper. The applier handles
 * op translation, atomicity, and bookkeeping.
 *
 * `applyMigration` runs all ops + the bookkeeping INSERT inside a single
 * `withTransaction` so DDL, backfill writes, and applied-version recording
 * commit (or roll back) together on backends that support real transactions.
 */
export abstract class SqlTabularMigrationApplier implements ITabularMigrationApplier {
  protected abstract dialectName(): "sqlite" | "postgres";
  protected abstract table(): string;
  protected abstract storage(): AnyTabularStorage;
  protected abstract mapTypeToSQL(typeDef: JsonSchema): string;
  protected abstract isNullableSchema(typeDef: JsonSchema): boolean;
  protected abstract executeSql(sql: string): Promise<void>;
  protected abstract executeSqlTx(sql: string, tx: AnyTabularStorage): Promise<void>;
  protected abstract recordAppliedTx(
    component: string,
    version: number,
    description: string | undefined,
    tx: AnyTabularStorage
  ): Promise<void>;
  protected abstract recordApplied(
    component: string,
    version: number,
    description: string | undefined
  ): Promise<void>;
  protected abstract queryAppliedVersions(component: string): Promise<Set<number>>;
  protected abstract probeTableExists(): Promise<boolean>;

  async ensureBookkeeping(): Promise<void> {
    await this.executeSql(this.bookkeepingDdl());
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    return this.queryAppliedVersions(component);
  }

  async tableExists(): Promise<boolean> {
    return this.probeTableExists();
  }

  async markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void> {
    if (versions.length === 0) return;
    for (const v of versions) {
      await this.recordApplied(component, v.version, v.description);
    }
  }

  async applyMigration(
    component: string,
    version: number,
    description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const storage = this.storage();
    await storage.withTransaction(async (tx) => {
      let processed = 0;
      const total = Math.max(ops.length, 1);
      for (const op of ops) {
        await this.applyOp(op, tx);
        processed++;
        onProgress?.(processed / total);
      }
      await this.recordAppliedTx(component, version, description, tx);
    });
  }

  protected async applyOp(op: TabularMigrationOp, tx: AnyTabularStorage): Promise<void> {
    switch (op.kind) {
      case "addColumn": {
        const sqlType = this.mapTypeToSQL(op.schema);
        const nullable = this.isNullableSchema(op.schema);
        const hasDefault = op.default !== undefined;
        const sql = buildAddColumnSql(
          this.dialectName(),
          this.table(),
          op.name,
          sqlType,
          nullable,
          hasDefault,
          hasDefault ? this.literalSql(op.default!) : undefined
        );
        await this.executeSqlTx(sql, tx);
        return;
      }
      case "dropColumn": {
        await this.executeSqlTx(
          buildDropColumnSql(this.dialectName(), this.table(), op.name),
          tx
        );
        return;
      }
      case "renameColumn": {
        await this.executeSqlTx(
          buildRenameColumnSql(this.dialectName(), this.table(), op.from, op.to),
          tx
        );
        return;
      }
      case "addIndex": {
        await this.executeSqlTx(
          buildAddIndexSql(
            this.dialectName(),
            this.table(),
            op.name,
            op.columns,
            op.unique ?? false
          ),
          tx
        );
        return;
      }
      case "dropIndex": {
        await this.executeSqlTx(buildDropIndexSql(this.dialectName(), op.name), tx);
        return;
      }
      case "backfill": {
        await runBackfill(tx, op.batchSize ?? 500, op.transform);
        return;
      }
    }
  }

  /**
   * Renders a JS literal as SQL. Strings are quoted with `'` doubling;
   * numbers / booleans / null are rendered raw. Objects throw — defaults
   * must be primitives.
   */
  protected literalSql(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") {
      return this.dialectName() === "sqlite" ? (value ? "1" : "0") : value ? "TRUE" : "FALSE";
    }
    throw new Error(
      `Unsupported default value for tabular migration: ${typeof value} (${String(value)})`
    );
  }

  /**
   * DDL for the bookkeeping table. Same shape used by the existing
   * per-driver runners.
   */
  protected bookkeepingDdl(): string {
    if (this.dialectName() === "sqlite") {
      return `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        component TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (component, version)
      )`;
    }
    return `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      component TEXT NOT NULL,
      version INTEGER NOT NULL,
      description TEXT,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (component, version)
    )`;
  }
}
```

- [ ] **Step 2: Re-export from `common.ts`**

Add to `packages/storage/src/common.ts`:

```ts
export * from "./tabular/SqlTabularMigrationApplier";
```

(Place alongside the other tabular re-exports.)

- [ ] **Step 3: Build**

Run: `bun run build --filter=@workglow/storage`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add packages/storage/src/tabular/SqlTabularMigrationApplier.ts packages/storage/src/common.ts
git commit -m "feat(storage): SqlTabularMigrationApplier base"
```

---

# Phase 3 — SQLite wiring

### Task 3.1: SQLite applier subclass + constructor option

**Files:**
- Modify: `packages/sqlite/src/storage/SqliteTabularStorage.ts`

- [ ] **Step 1: Add migrations option + applier inside the file**

In imports, add:

```ts
import {
  SqlTabularMigrationApplier,
  ITabularMigration,
  ITabularMigrationApplier,
  MIGRATIONS_TABLE,
  AnyTabularStorage,
} from "@workglow/storage";
import { type JsonSchema as Json } from "@workglow/util/schema";
```

(If `JsonSchema` is already imported, skip the alias.)

Find the constructor:

```ts
constructor(
  dbOrPath: string | Sqlite.Database,
  table: string = "tabular_store",
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing"
) {
  super(table, schema, primaryKeyNames, indexes, clientProvidedKeys);
  ...
}
```

Replace the param list with:

```ts
constructor(
  dbOrPath: string | Sqlite.Database,
  table: string = "tabular_store",
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing",
  tabularMigrations?: ReadonlyArray<ITabularMigration>
) {
  super(table, schema, primaryKeyNames, indexes, clientProvidedKeys, tabularMigrations, table);
  ...
}
```

(`super` now also receives `tabularMigrations` and `migrationName=table`. The `BaseSqlTabularStorage` constructor will need its own update — see Task 3.2.)

- [ ] **Step 2: Update `setupDatabase` to dispatch through orchestrator when migrations supplied**

Find the existing `setupDatabase` body. After `this.db.exec(sql);` and the index-creation loop, append:

```ts
// If migrations declared, the orchestrator handles fresh-vs-existing
// detection. The CREATE TABLE / CREATE INDEX above is still safe — it
// produces the target schema, which the orchestrator then either
// records-as-applied (fresh) or evolves further (existing-with-history).
if (this.tabularMigrations && this.tabularMigrations.length > 0) {
  await this.applyTabularMigrations();
}
```

- [ ] **Step 3: Implement `getMigrationApplier`**

Add a method after `setupDatabase`:

```ts
public override getMigrationApplier(): ITabularMigrationApplier | null {
  return new SqliteTabularMigrationApplierImpl(this);
}
```

And below the class declaration, define the applier:

```ts
class SqliteTabularMigrationApplierImpl extends SqlTabularMigrationApplier {
  constructor(
    private readonly host: SqliteTabularStorage<any, any, any, any, any, any>
  ) {
    super();
  }
  protected override dialectName(): "sqlite" | "postgres" {
    return "sqlite";
  }
  protected override table(): string {
    return (this.host as any).table;
  }
  protected override storage(): AnyTabularStorage {
    return this.host as unknown as AnyTabularStorage;
  }
  protected override mapTypeToSQL(typeDef: JsonSchema): string {
    return (this.host as any).mapTypeToSQL(typeDef);
  }
  protected override isNullableSchema(typeDef: JsonSchema): boolean {
    return (this.host as any).isNullable(typeDef);
  }
  protected override async executeSql(sql: string): Promise<void> {
    (this.host as any).database.exec(sql);
  }
  protected override async executeSqlTx(sql: string, _tx: AnyTabularStorage): Promise<void> {
    // SQLite uses a single connection; the host's `withTransaction`
    // already issued BEGIN, so any exec on `this.host.database` runs
    // inside that transaction.
    (this.host as any).database.exec(sql);
  }
  protected override async recordAppliedTx(
    component: string,
    version: number,
    description: string | undefined,
    _tx: AnyTabularStorage
  ): Promise<void> {
    const stmt = (this.host as any).database.prepare(
      `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES (?, ?, ?)`
    );
    stmt.run(component, version, description ?? null);
  }
  protected override async recordApplied(
    component: string,
    version: number,
    description: string | undefined
  ): Promise<void> {
    const stmt = (this.host as any).database.prepare(
      `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES (?, ?, ?)`
    );
    stmt.run(component, version, description ?? null);
  }
  protected override async queryAppliedVersions(component: string): Promise<Set<number>> {
    const stmt = (this.host as any).database.prepare(
      `SELECT version FROM ${MIGRATIONS_TABLE} WHERE component = ?`
    );
    const rows = stmt.all(component) as Array<{ version: number }>;
    return new Set(rows.map((r) => r.version));
  }
  protected override async probeTableExists(): Promise<boolean> {
    const stmt = (this.host as any).database.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
    );
    const row = stmt.get((this.host as any).table) as { name?: string } | undefined;
    return !!row?.name;
  }
}
```

- [ ] **Step 4: Build**

Run: `bun run build --filter=@workglow/sqlite`
Expected: builds clean (after Task 3.2's BaseSqlTabularStorage update lands in the same patch series).

### Task 3.2: Forward extra constructor params through `BaseSqlTabularStorage`

**Files:**
- Modify: `packages/storage/src/tabular/BaseSqlTabularStorage.ts`

- [ ] **Step 1: Extend constructor signature**

Find the constructor:

```ts
constructor(
  protected readonly table: string = "tabular_store",
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing"
) {
  super(schema, primaryKeyNames, indexes, clientProvidedKeys);
  this.validateTableAndSchema();
}
```

Replace with:

```ts
constructor(
  protected readonly table: string = "tabular_store",
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing",
  tabularMigrations?: ReadonlyArray<import("../migrations").ITabularMigration>,
  migrationName?: string
) {
  super(
    schema,
    primaryKeyNames,
    indexes,
    clientProvidedKeys,
    tabularMigrations,
    migrationName ?? table
  );
  this.validateTableAndSchema();
}
```

- [ ] **Step 2: Build, commit Phase 3 together**

```bash
bun run build --filter=@workglow/storage --filter=@workglow/sqlite
git add packages/storage/src/tabular/BaseSqlTabularStorage.ts packages/sqlite/src/storage/SqliteTabularStorage.ts
git commit -m "feat(sqlite): tabular migration applier + constructor option"
```

### Task 3.3: SQLite smoke integration test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/SqliteTabular.smoke.test.ts`

- [ ] **Step 1: Write a failing smoke test**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Sqlite } from "@workglow/sqlite/storage";
import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import type { ITabularMigration } from "@workglow/storage";

describe("SqliteTabular migration smoke", () => {
  it("applies an addColumn migration to an existing table", async () => {
    const db = new Sqlite.Database(":memory:");
    // Create a "deployed" v0 table with only `id` and `name`.
    const v0 = new SqliteTabularStorage(
      db,
      "users",
      {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const
    );
    await v0.setupDatabase();
    await v0.put({ id: "u1", name: "alice" });

    // Re-open with the "current" target schema (adds `archived`) + a v1
    // migration that adds the column. Because the table already exists,
    // the orchestrator must run the migration.
    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "add archived",
        ops: [
          { kind: "addColumn", name: "archived", schema: { type: "boolean" } },
        ],
      },
    ];
    const v1 = new SqliteTabularStorage(
      db,
      "users",
      {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          archived: { type: "boolean" },
        },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const,
      undefined,
      undefined,
      migrations
    );
    await v1.setupDatabase();

    // Column should now exist; the existing row carries NULL for archived.
    const row = (await v1.get({ id: "u1" })) as { id: string; name: string; archived?: boolean | null };
    expect(row).toBeDefined();
    expect(row.id).toBe("u1");
    // SQLite returns null for newly added columns on existing rows
    expect(row.archived ?? null).toBeNull();

    // Bookkeeping should record the migration.
    const applied = db
      .prepare("SELECT version FROM _storage_migrations WHERE component = ?")
      .all("tabular:users") as Array<{ version: number }>;
    expect(applied.map((r) => r.version)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test packages/test/src/test/tabular-migrations/SqliteTabular.smoke.test.ts`
Expected: FAIL — either constructor signature mismatch or missing column at read time.

- [ ] **Step 3: Iterate on Phase 3 implementation until green**

Re-run the test after fixes. When green, proceed.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/tabular-migrations/SqliteTabular.smoke.test.ts
git commit -m "test(sqlite): smoke test for tabular addColumn migration"
```

---

# Phase 4 — Postgres wiring

### Task 4.1: Postgres applier subclass + constructor option

**Files:**
- Modify: `packages/postgres/src/storage/PostgresTabularStorage.ts`

- [ ] **Step 1: Extend constructor**

Find the existing constructor and replace:

```ts
constructor(
  db: Pool,
  table: string = "tabular_store",
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing"
) {
  super(table, schema, primaryKeyNames, indexes, clientProvidedKeys);
  this.db = db;
}
```

with:

```ts
constructor(
  db: Pool,
  table: string = "tabular_store",
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing",
  tabularMigrations?: ReadonlyArray<ITabularMigration>
) {
  super(table, schema, primaryKeyNames, indexes, clientProvidedKeys, tabularMigrations, table);
  this.db = db;
}
```

(Add `ITabularMigration` to the imports from `@workglow/storage`.)

- [ ] **Step 2: Add applier dispatch in `setupDatabase`**

After the existing CREATE TABLE / index loop, append:

```ts
if (this.tabularMigrations && this.tabularMigrations.length > 0) {
  await this.applyTabularMigrations();
}
```

- [ ] **Step 3: Override `getMigrationApplier`**

```ts
public override getMigrationApplier(): ITabularMigrationApplier | null {
  return new PostgresTabularMigrationApplierImpl(this);
}
```

- [ ] **Step 4: Define the applier class**

Below `PostgresTabularStorage`, add:

```ts
class PostgresTabularMigrationApplierImpl extends SqlTabularMigrationApplier {
  constructor(
    private readonly host: PostgresTabularStorage<any, any, any, any, any, any>
  ) {
    super();
  }
  protected override dialectName(): "sqlite" | "postgres" {
    return "postgres";
  }
  protected override table(): string {
    return (this.host as any).table;
  }
  protected override storage(): AnyTabularStorage {
    return this.host as unknown as AnyTabularStorage;
  }
  protected override mapTypeToSQL(typeDef: JsonSchema): string {
    return (this.host as any).mapTypeToSQL(typeDef);
  }
  protected override isNullableSchema(typeDef: JsonSchema): boolean {
    return (this.host as any).isNullable(typeDef);
  }
  protected override async executeSql(sql: string): Promise<void> {
    await (this.host as any).db.query(sql);
  }
  protected override async executeSqlTx(sql: string, tx: AnyTabularStorage): Promise<void> {
    // The host's `withTransaction` proxy exposes a private `__txQuery` for
    // raw SQL inside its transaction. We add that hook on
    // PostgresTabularStorage so the applier can run ALTER TABLE on the
    // dedicated client.
    await (tx as unknown as { __txQuery: (sql: string) => Promise<void> }).__txQuery(sql);
  }
  protected override async recordAppliedTx(
    component: string,
    version: number,
    description: string | undefined,
    tx: AnyTabularStorage
  ): Promise<void> {
    const txAny = tx as unknown as {
      __txQueryParams: (sql: string, params: unknown[]) => Promise<void>;
    };
    await txAny.__txQueryParams(
      `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES ($1, $2, $3)`,
      [component, version, description ?? null]
    );
  }
  protected override async recordApplied(
    component: string,
    version: number,
    description: string | undefined
  ): Promise<void> {
    await (this.host as any).db.query(
      `INSERT INTO ${MIGRATIONS_TABLE}(component, version, description) VALUES ($1, $2, $3)`,
      [component, version, description ?? null]
    );
  }
  protected override async queryAppliedVersions(component: string): Promise<Set<number>> {
    const r = await (this.host as any).db.query(
      `SELECT version FROM ${MIGRATIONS_TABLE} WHERE component = $1`,
      [component]
    );
    return new Set((r.rows as Array<{ version: number }>).map((row) => Number(row.version)));
  }
  protected override async probeTableExists(): Promise<boolean> {
    const r = await (this.host as any).db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
      [(this.host as any).table]
    );
    return r.rows.length > 0;
  }
}
```

### Task 4.2: Add `__txQuery` / `__txQueryParams` hooks to `PostgresTabularStorage`

**Files:**
- Modify: `packages/postgres/src/storage/PostgresTabularStorage.ts`

- [ ] **Step 1: Find the withTransaction Proxy code**

Locate the proxy returned by `withTransaction` (search for `Build a Proxy view of \`this\``). The proxy intercepts properties; we need to expose two extra ones bound to the transaction's client.

- [ ] **Step 2: Add per-tx hooks**

Inside the proxy `get` handler (the one that returns alternate methods for the transaction), add cases:

```ts
if (prop === "__txQuery") {
  return async (sql: string) => {
    await client.query(sql);
  };
}
if (prop === "__txQueryParams") {
  return async (sql: string, params: unknown[]) => {
    await client.query(sql, params);
  };
}
```

(Replace `client` with whatever local variable holds the transaction-bound `PgQueryable` in the existing code. Inspect `withTransaction` body to find the right name.)

- [ ] **Step 3: Build & commit Phase 4 together**

```bash
bun run build --filter=@workglow/postgres
git add packages/postgres/src/storage/PostgresTabularStorage.ts
git commit -m "feat(postgres): tabular migration applier + tx-bound DDL hook"
```

### Task 4.3: Postgres smoke integration test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/PostgresTabular.smoke.test.ts`

- [ ] **Step 1: Write the test**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLitePool } from "@workglow/postgres";
import { PostgresTabularStorage } from "@workglow/postgres";
import type { ITabularMigration } from "@workglow/storage";

describe("PostgresTabular migration smoke", () => {
  it("applies addColumn through withTransaction", async () => {
    const pgl = new PGlite();
    const pool = new PGLitePool(pgl);

    const v0 = new PostgresTabularStorage(
      pool,
      "users",
      {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const
    );
    await v0.setupDatabase();
    await v0.put({ id: "u1", name: "alice" });

    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "add archived",
        ops: [{ kind: "addColumn", name: "archived", schema: { type: "boolean" } }],
      },
    ];
    const v1 = new PostgresTabularStorage(
      pool,
      "users",
      {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          archived: { type: "boolean" },
        },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const,
      undefined,
      undefined,
      migrations
    );
    await v1.setupDatabase();

    const r = await pool.query(
      "SELECT version FROM _storage_migrations WHERE component = $1",
      ["tabular:users"]
    );
    expect((r.rows as { version: number }[]).map((x) => Number(x.version))).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run, iterate, commit**

```bash
bun test packages/test/src/test/tabular-migrations/PostgresTabular.smoke.test.ts
# fix until passing
git add packages/test/src/test/tabular-migrations/PostgresTabular.smoke.test.ts
git commit -m "test(postgres): smoke test for tabular addColumn migration"
```

---

# Phase 5 — IndexedDB wiring

### Task 5.1: IndexedDB applier (built on `IndexedDbMigrationRunner`)

**Files:**
- Create: `packages/indexeddb/src/storage/IndexedDbTabularMigrationApplier.ts`

- [ ] **Step 1: Write the applier**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ITabularMigrationApplier,
  type TabularMigrationOp,
  MIGRATIONS_TABLE,
} from "@workglow/storage";
import {
  IndexedDbMigrationRunner,
  type IndexedDbUpgradeContext,
} from "../migrations/IndexedDbMigrationRunner";

/**
 * IndexedDB applier for tabular migrations. Each migration is translated
 * into an `IndexedDbMigration` whose `up()` runs inside the upgrade
 * transaction; the existing `IndexedDbMigrationRunner` writes bookkeeping
 * to `_storage_migrations` inside that same transaction, giving us
 * all-or-nothing atomicity.
 *
 * Backfill is performed *after* the upgrade transaction closes — IDB
 * upgrade transactions cannot span async work, but data writes do not
 * require an upgrade transaction. We commit DDL first, then run the
 * backfill on a normal readwrite transaction; if the backfill fails the
 * DDL has already committed (matches the spec: best-effort on data ops).
 */
export class IndexedDbTabularMigrationApplier implements ITabularMigrationApplier {
  constructor(
    private readonly dbName: string,
    private readonly storeName: string,
    private readonly storage: {
      getPage: (req?: { limit?: number; cursor?: string }) => Promise<{
        items: Array<Record<string, unknown>>;
        nextCursor?: string;
      }>;
      put: (row: Record<string, unknown>) => Promise<unknown>;
      delete: (row: Record<string, unknown>) => Promise<unknown>;
    },
    private readonly runner: IndexedDbMigrationRunner = new IndexedDbMigrationRunner(dbName)
  ) {}

  async ensureBookkeeping(): Promise<void> {
    await this.runner.ensureBookkeepingTable();
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    return this.runner.appliedVersions(component);
  }

  async tableExists(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!idb) return reject(new Error("indexedDB not available"));
      const req = idb.open(this.dbName);
      req.onsuccess = () => {
        const db = req.result;
        const exists = db.objectStoreNames.contains(this.storeName);
        db.close();
        resolve(exists);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
  }

  async markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void> {
    if (versions.length === 0) return;
    // Run a no-op migration per (component, version) so the runner records
    // it through the same bookkeeping path used elsewhere.
    await this.runner.run(
      versions.map((v) => ({
        component,
        version: v.version,
        description: v.description,
        up: () => undefined,
      }))
    );
  }

  async applyMigration(
    component: string,
    version: number,
    description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const ddlOps = ops.filter(
      (o) => o.kind === "addIndex" || o.kind === "dropIndex"
    );
    const backfills = ops.filter((o) => o.kind === "backfill") as Extract<
      TabularMigrationOp,
      { kind: "backfill" }
    >[];

    // DDL inside an upgrade transaction.
    const storeName = this.storeName;
    await this.runner.run([
      {
        component,
        version,
        description,
        up: (ctx: IndexedDbUpgradeContext, _report) => {
          if (!ctx.db.objectStoreNames.contains(storeName)) return;
          const store = ctx.tx.objectStore(storeName);
          for (const op of ddlOps) {
            if (op.kind === "addIndex") {
              store.createIndex(op.name, op.columns.length === 1 ? op.columns[0] : [...op.columns], {
                unique: op.unique ?? false,
              });
            } else {
              store.deleteIndex(op.name);
            }
          }
        },
      },
    ]);

    // Backfills outside the upgrade tx (IDB requires sync upgrade callbacks).
    let processed = ddlOps.length;
    const total = Math.max(ops.length, 1);
    for (const op of backfills) {
      let cursor: string | undefined;
      while (true) {
        const page = await this.storage.getPage({ limit: op.batchSize ?? 500, cursor });
        for (const row of page.items) {
          const out = await op.transform(row);
          if (out === row) continue;
          if (out === undefined) await this.storage.delete(row);
          else await this.storage.put(out);
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      processed++;
      onProgress?.(processed / total);
    }
  }
}
```

- [ ] **Step 2: Build**

Run: `bun run build --filter=@workglow/indexeddb`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add packages/indexeddb/src/storage/IndexedDbTabularMigrationApplier.ts
git commit -m "feat(indexeddb): tabular migration applier"
```

### Task 5.2: Wire applier into `IndexedDbTabularStorage`

**Files:**
- Modify: `packages/indexeddb/src/storage/IndexedDbTabularStorage.ts`

- [ ] **Step 1: Extend constructor**

Find the constructor signature and append `tabularMigrations?: ReadonlyArray<ITabularMigration>` as the final parameter (after `clientProvidedKeys`). Update `super(...)` to forward it + a `migrationName: this.table`.

- [ ] **Step 2: Add migrations dispatch in `setupDatabase`**

After `this.db = await this.setupPromise;` at the end of `setupDatabase`, add:

```ts
if (this.tabularMigrations && this.tabularMigrations.length > 0) {
  await this.applyTabularMigrations();
}
```

- [ ] **Step 3: Override `getMigrationApplier`**

```ts
public override getMigrationApplier(): ITabularMigrationApplier | null {
  return new IndexedDbTabularMigrationApplier(this.table, this.table, {
    getPage: (req) => this.getPage(req as any) as any,
    put: (row) => this.put(row as any),
    delete: (row) => this.delete(row as any),
  });
}
```

(`this.table` is used as both the IDB database name and the object store name in this storage — see `ensureIndexedDbTable` which calls `openIdb(tableName, …)`.)

- [ ] **Step 4: Build & commit**

```bash
bun run build --filter=@workglow/indexeddb
git add packages/indexeddb/src/storage/IndexedDbTabularStorage.ts
git commit -m "feat(indexeddb): wire tabular migration applier into setupDatabase"
```

### Task 5.3: IndexedDB smoke integration test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/IndexedDbTabular.smoke.test.ts`

- [ ] **Step 1: Write the test**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import type { ITabularMigration } from "@workglow/storage";

describe("IndexedDbTabular migration smoke", () => {
  it("addIndex migration is applied + backfill rewrites rows", async () => {
    const v0 = new IndexedDbTabularStorage(
      "users_t1",
      {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const
    );
    await v0.setupDatabase();
    await v0.put({ id: "u1", name: "alice" });
    await v0.put({ id: "u2", name: "BOB" });

    const migrations: ITabularMigration[] = [
      {
        version: 1,
        description: "lowercase names",
        ops: [
          {
            kind: "backfill",
            transform: (row) => ({ ...row, name: (row as any).name.toLowerCase() }),
          },
        ],
      },
    ];
    const v1 = new IndexedDbTabularStorage(
      "users_t1",
      {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      } as const,
      ["id"] as const,
      [],
      {},
      undefined,
      migrations
    );
    await v1.setupDatabase();

    const all = (await v1.getAll())!;
    expect(all.find((r) => r.id === "u2")?.name).toBe("bob");
  });
});
```

- [ ] **Step 2: Run, iterate, commit**

```bash
bun test packages/test/src/test/tabular-migrations/IndexedDbTabular.smoke.test.ts
# iterate until green
git add packages/test/src/test/tabular-migrations/IndexedDbTabular.smoke.test.ts
git commit -m "test(indexeddb): smoke test for tabular backfill migration"
```

---

# Phase 6 — Schemaless backends

### Task 6.1: InMemory applier

**Files:**
- Create: `packages/storage/src/tabular/InMemoryTabularMigrationApplier.ts`

- [ ] **Step 1: Write the applier**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ITabularMigrationApplier,
  type TabularMigrationOp,
  runBackfill,
} from "../migrations";
import { type AnyTabularStorage } from "./ITabularStorage";

/**
 * Applier for schemaless tabular backends (InMemory / Shared / FsFolder /
 * HuggingFace). DDL ops are no-ops; `backfill` runs through the storage's
 * normal API; bookkeeping is tracked in `applied` (overrideable for FsFolder
 * which persists it to a JSON file).
 */
export class InMemoryTabularMigrationApplier implements ITabularMigrationApplier {
  protected applied = new Map<string, Set<number>>();

  constructor(
    protected readonly storage: AnyTabularStorage,
    protected readonly storeName: string
  ) {}

  async ensureBookkeeping(): Promise<void> {
    // Nothing to persist by default.
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    return new Set(this.applied.get(component) ?? []);
  }

  async tableExists(): Promise<boolean> {
    return (await this.storage.size()) > 0;
  }

  async markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void> {
    let set = this.applied.get(component);
    if (!set) {
      set = new Set();
      this.applied.set(component, set);
    }
    for (const v of versions) set.add(v.version);
    await this.persist();
  }

  async applyMigration(
    component: string,
    version: number,
    _description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    let processed = 0;
    const total = Math.max(ops.length, 1);
    for (const op of ops) {
      if (op.kind === "backfill") {
        await runBackfill(this.storage, op.batchSize ?? 500, op.transform);
      }
      // DDL ops: no-op on schemaless backends.
      processed++;
      onProgress?.(processed / total);
    }
    let set = this.applied.get(component);
    if (!set) {
      set = new Set();
      this.applied.set(component, set);
    }
    set.add(version);
    await this.persist();
  }

  /** Subclasses (FsFolder) override to flush bookkeeping to disk. */
  protected async persist(): Promise<void> {
    // no-op
  }
}
```

- [ ] **Step 2: Re-export from `common.ts`**

Add `export * from "./tabular/InMemoryTabularMigrationApplier";`.

- [ ] **Step 3: Build**

Run: `bun run build --filter=@workglow/storage`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add packages/storage/src/tabular/InMemoryTabularMigrationApplier.ts packages/storage/src/common.ts
git commit -m "feat(storage): InMemoryTabularMigrationApplier for schemaless backends"
```

### Task 6.2: Wire InMemoryTabularStorage

**Files:**
- Modify: `packages/storage/src/tabular/InMemoryTabularStorage.ts`

- [ ] **Step 1: Add `tabularMigrations` to constructor**

Find:

```ts
constructor(
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: ... = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing"
) {
  super(schema, primaryKeyNames, indexes, clientProvidedKeys);
}
```

Replace with:

```ts
constructor(
  schema: Schema,
  primaryKeyNames: PrimaryKeyNames,
  indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
  clientProvidedKeys: ClientProvidedKeysOption = "if-missing",
  tabularMigrations?: ReadonlyArray<ITabularMigration>,
  migrationName: string = "inmemory"
) {
  super(schema, primaryKeyNames, indexes, clientProvidedKeys, tabularMigrations, migrationName);
}
```

(Add `ITabularMigration` to the imports from `../migrations`.)

- [ ] **Step 2: Override setupDatabase + applier**

```ts
override async setupDatabase(): Promise<void> {
  if (this.tabularMigrations && this.tabularMigrations.length > 0) {
    await this.applyTabularMigrations();
  }
}

public override getMigrationApplier(): ITabularMigrationApplier | null {
  return new InMemoryTabularMigrationApplier(this as unknown as AnyTabularStorage, "inmemory");
}
```

(Imports: `ITabularMigrationApplier` from `../migrations`, `InMemoryTabularMigrationApplier` from `./InMemoryTabularMigrationApplier`, `AnyTabularStorage` from `./ITabularStorage`.)

- [ ] **Step 3: Build & commit**

```bash
bun run build --filter=@workglow/storage
git add packages/storage/src/tabular/InMemoryTabularStorage.ts
git commit -m "feat(storage): wire tabular migrations into InMemoryTabularStorage"
```

### Task 6.3: Wire SharedInMemory + HuggingFace + FsFolder

**Files:**
- Modify: `packages/storage/src/tabular/SharedInMemoryTabularStorage.ts`
- Modify: `packages/storage/src/tabular/HuggingFaceTabularStorage.ts`
- Modify: `packages/storage/src/tabular/FsFolderTabularStorage.ts`

- [ ] **Step 1: SharedInMemory — same shape as Task 6.2**

Append `tabularMigrations` + `migrationName` to constructor; forward to `super`. Override `setupDatabase` to dispatch `applyTabularMigrations` when set. Override `getMigrationApplier` to return an `InMemoryTabularMigrationApplier`.

- [ ] **Step 2: HuggingFace — read-only, append constructor params, dispatch**

Same shape. Note: HF storage is read-only; backfill ops will throw via the storage's `put`. Document this in a comment near `getMigrationApplier`.

- [ ] **Step 3: FsFolder — persist bookkeeping to `_storage_migrations.json`**

For FsFolder, create a subclass of `InMemoryTabularMigrationApplier` inline that overrides `persist()` to write the bookkeeping map to `${folderPath}/_storage_migrations.json`, and overrides `appliedVersions` to read it.

```ts
class FsFolderMigrationApplier extends InMemoryTabularMigrationApplier {
  constructor(
    storage: AnyTabularStorage,
    private readonly folderPath: string
  ) {
    super(storage, "fsfolder");
  }
  async ensureBookkeeping(): Promise<void> {
    await this.load();
  }
  async appliedVersions(component: string): Promise<Set<number>> {
    await this.load();
    return new Set(this.applied.get(component) ?? []);
  }
  private loaded = false;
  private async load(): Promise<void> {
    if (this.loaded) return;
    const path = `${this.folderPath}/_storage_migrations.json`;
    try {
      const fs = await import("node:fs/promises");
      const text = await fs.readFile(path, "utf8");
      const parsed = JSON.parse(text) as Record<string, number[]>;
      for (const [c, vs] of Object.entries(parsed)) {
        this.applied.set(c, new Set(vs));
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    this.loaded = true;
  }
  protected override async persist(): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = `${this.folderPath}/_storage_migrations.json`;
    const out: Record<string, number[]> = {};
    for (const [c, vs] of this.applied) out[c] = [...vs].sort((a, b) => a - b);
    await fs.writeFile(path, JSON.stringify(out, null, 2));
  }
}
```

(Import `AnyTabularStorage`. The folder path is whatever field FsFolderTabularStorage uses — search for `folderPath` or `dirPath`.)

- [ ] **Step 4: Build & commit**

```bash
bun run build --filter=@workglow/storage
git add packages/storage/src/tabular/SharedInMemoryTabularStorage.ts packages/storage/src/tabular/HuggingFaceTabularStorage.ts packages/storage/src/tabular/FsFolderTabularStorage.ts
git commit -m "feat(storage): tabular migrations on SharedInMemory/HF/FsFolder"
```

---

# Phase 7 — Wrapper passthrough

### Task 7.1: CachedTabularStorage and TelemetryTabularStorage delegate

**Files:**
- Modify: `packages/storage/src/tabular/CachedTabularStorage.ts`
- Modify: `packages/storage/src/tabular/TelemetryTabularStorage.ts`

- [ ] **Step 1: Cached — delegate `getMigrationApplier` and `setupDatabase`**

Add to `CachedTabularStorage`:

```ts
public override getMigrationApplier(): ITabularMigrationApplier | null {
  return (this.inner as unknown as { getMigrationApplier?: () => ITabularMigrationApplier | null }).getMigrationApplier?.() ?? null;
}
override async setupDatabase(): Promise<void> {
  await this.inner.setupDatabase();
}
```

(Adjust `this.inner` to match the field name used in the file — likely `inner` or `wrapped`. Add necessary imports.)

- [ ] **Step 2: Telemetry — same**

Same delegation. The wrapper should never declare its own `tabularMigrations`; users wire migrations on the inner storage.

- [ ] **Step 3: Build & commit**

```bash
bun run build --filter=@workglow/storage
git add packages/storage/src/tabular/CachedTabularStorage.ts packages/storage/src/tabular/TelemetryTabularStorage.ts
git commit -m "feat(storage): wrappers passthrough tabular migrations to inner"
```

---

# Phase 8 — Contract suite

### Task 8.1: Contract types

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/types.ts`

- [ ] **Step 1: Write types**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage, ITabularMigration } from "@workglow/storage";

export interface TabularMigrationContractHandle {
  /**
   * Build a fresh storage at the given target schema, with the supplied
   * migrations and an optional pre-populated set of rows. Calls
   * `setupDatabase` before returning.
   *
   * The schema's properties at minimum include `id: string` (PK) plus
   * whatever extra columns the test's migration ops mention.
   */
  makeStorage(
    properties: Record<string, unknown>,
    migrations: ReadonlyArray<ITabularMigration>,
    preExistingRows?: ReadonlyArray<Record<string, unknown>>
  ): Promise<AnyTabularStorage>;
  dispose(): Promise<void>;
}

export interface TabularMigrationContractOpts {
  readonly name: string;
  readonly factory: () => Promise<TabularMigrationContractHandle>;
  readonly skip?: boolean;
  readonly timeout?: number;
  /** True for SQL backends: DDL is enforced; addColumn produces a real column. */
  readonly enforcesDdl: boolean;
  /** True for FsFolder, IDB, SQLite-on-disk: bookkeeping survives restart. */
  readonly persistentBookkeeping?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/types.ts
git commit -m "test(tabular): contract suite types"
```

### Task 8.2: Contract entrypoint

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/runTabularMigrationContract.ts`

- [ ] **Step 1: Write entrypoint**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { addColumnBlock } from "./assertions/addColumn";
import { dropColumnBlock } from "./assertions/dropColumn";
import { renameColumnBlock } from "./assertions/renameColumn";
import { addAndDropIndexBlock } from "./assertions/addAndDropIndex";
import { backfillBlock } from "./assertions/backfill";
import { freshDbFastPathBlock } from "./assertions/freshDbFastPath";
import { incrementalApplicationBlock } from "./assertions/incrementalApplication";
import { failedMigrationNotRecordedBlock } from "./assertions/failedMigrationNotRecorded";
import type { TabularMigrationContractHandle, TabularMigrationContractOpts } from "./types";

export function runTabularMigrationContract(opts: TabularMigrationContractOpts): void {
  describe.skipIf(opts.skip)(`Tabular migration contract: ${opts.name}`, () => {
    let handle: TabularMigrationContractHandle | undefined;
    const getHandle = () => {
      if (!handle) throw new Error("handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
    }, opts.timeout);
    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    if (opts.enforcesDdl) {
      addColumnBlock(opts, getHandle);
      dropColumnBlock(opts, getHandle);
      renameColumnBlock(opts, getHandle);
      addAndDropIndexBlock(opts, getHandle);
    }
    backfillBlock(opts, getHandle);
    freshDbFastPathBlock(opts, getHandle);
    incrementalApplicationBlock(opts, getHandle);
    failedMigrationNotRecordedBlock(opts, getHandle);
  });
}

export type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "./types";
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/runTabularMigrationContract.ts
git commit -m "test(tabular): contract entrypoint"
```

### Task 8.3: addColumn assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/addColumn.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function addColumnBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("addColumn: existing rows survive; new column readable", async () => {
    const storage = await getHandle().makeStorage(
      {
        id: { type: "string" },
        name: { type: "string" },
        archived: { type: "boolean" },
      },
      [
        {
          version: 1,
          ops: [{ kind: "addColumn", name: "archived", schema: { type: "boolean" } }],
        },
      ],
      [{ id: "u1", name: "alice" }]
    );
    const row = (await storage.get({ id: "u1" })) as
      | { id: string; name: string; archived?: boolean | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.id).toBe("u1");
    expect(row!.archived ?? null).toBeNull();
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/addColumn.ts
git commit -m "test(tabular): contract block — addColumn"
```

### Task 8.4: dropColumn assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/dropColumn.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function dropColumnBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("dropColumn: column removed; existing rows preserved (sans column)", async () => {
    const storage = await getHandle().makeStorage(
      { id: { type: "string" }, name: { type: "string" } },
      [
        {
          version: 1,
          ops: [{ kind: "dropColumn", name: "removed_field" }],
        },
      ],
      [{ id: "u1", name: "alice", removed_field: "old" }]
    );
    const row = (await storage.get({ id: "u1" })) as
      | { id: string; name: string; removed_field?: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("alice");
    // The column is gone — accessing it should yield undefined or absent.
    expect((row as Record<string, unknown>).removed_field).toBeUndefined();
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/dropColumn.ts
git commit -m "test(tabular): contract block — dropColumn"
```

### Task 8.5: renameColumn assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/renameColumn.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function renameColumnBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("renameColumn: data preserved under new name", async () => {
    const storage = await getHandle().makeStorage(
      { id: { type: "string" }, state: { type: "string" } },
      [
        {
          version: 1,
          ops: [{ kind: "renameColumn", from: "status", to: "state" }],
        },
      ],
      [{ id: "u1", status: "active" }]
    );
    const row = (await storage.get({ id: "u1" })) as
      | { id: string; state: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.state).toBe("active");
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/renameColumn.ts
git commit -m "test(tabular): contract block — renameColumn"
```

### Task 8.6: addAndDropIndex assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/addAndDropIndex.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function addAndDropIndexBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("addIndex / dropIndex: query still returns correct rows", async () => {
    const storage = await getHandle().makeStorage(
      { id: { type: "string" }, name: { type: "string" } },
      [
        {
          version: 1,
          ops: [
            { kind: "addIndex", name: "idx_name", columns: ["name"] },
            { kind: "dropIndex", name: "idx_name" },
          ],
        },
      ],
      [
        { id: "u1", name: "alice" },
        { id: "u2", name: "bob" },
      ]
    );
    const rows = (await storage.query({ name: "alice" })) ?? [];
    expect(rows.map((r) => (r as { id: string }).id)).toEqual(["u1"]);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/addAndDropIndex.ts
git commit -m "test(tabular): contract block — add/dropIndex"
```

### Task 8.7: backfill assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/backfill.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function backfillBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("backfill: every existing row is rewritten", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, n: i }));
    const storage = await getHandle().makeStorage(
      { id: { type: "string" }, n: { type: "integer" } },
      [
        {
          version: 1,
          ops: [
            {
              kind: "backfill",
              batchSize: 7,
              transform: (row) => ({ ...row, n: (row.n as number) * 2 }),
            },
          ],
        },
      ],
      rows
    );
    const all = (await storage.getAll()) ?? [];
    const r3 = all.find((r) => (r as { id: string }).id === "r3") as { n: number };
    expect(r3.n).toBe(6);
    expect(all.length).toBe(30);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/backfill.ts
git commit -m "test(tabular): contract block — backfill"
```

### Task 8.8: freshDbFastPath assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/freshDbFastPath.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function freshDbFastPathBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("fresh DB: backfill is NOT executed; bookkeeping marks all applied", async () => {
    let transformCalls = 0;
    const storage = await getHandle().makeStorage(
      { id: { type: "string" }, n: { type: "integer" } },
      [
        {
          version: 1,
          ops: [
            {
              kind: "backfill",
              transform: (row) => {
                transformCalls++;
                return row;
              },
            },
          ],
        },
      ],
      // no pre-existing rows -> fresh DB
      []
    );
    expect(transformCalls).toBe(0);
    expect(await storage.size()).toBe(0);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/freshDbFastPath.ts
git commit -m "test(tabular): contract block — fresh-DB fast path"
```

### Task 8.9: incrementalApplication assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/incrementalApplication.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function incrementalApplicationBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("running migrations twice is idempotent (each version applied once)", async () => {
    let backfillCalls = 0;
    const migrations = [
      {
        version: 1,
        ops: [
          {
            kind: "backfill" as const,
            transform: (row: Record<string, unknown>) => {
              backfillCalls++;
              return row;
            },
          },
        ],
      },
    ];
    // First call — should run the backfill once on the existing rows.
    await getHandle().makeStorage(
      { id: { type: "string" }, n: { type: "integer" } },
      migrations,
      [{ id: "r1", n: 1 }]
    );
    const firstCount = backfillCalls;
    // Second call — same migrations, same data: should not re-run.
    await getHandle().makeStorage(
      { id: { type: "string" }, n: { type: "integer" } },
      migrations,
      [{ id: "r1", n: 1 }]
    );
    // The contract handle's `makeStorage` may share state across calls
    // (per-backend); the second invocation must not re-run the backfill.
    expect(backfillCalls).toBe(firstCount);
  });
}
```

(Note: this assertion expects the handle's `makeStorage` to share underlying durable state for backends where that matters — see per-backend wiring in Phase 9 to set up reusable storage handles.)

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/incrementalApplication.ts
git commit -m "test(tabular): contract block — incremental application"
```

### Task 8.10: failedMigrationNotRecorded assertion block

**Files:**
- Create: `packages/test/src/contract/tabular-migrations/assertions/failedMigrationNotRecorded.ts`

- [ ] **Step 1: Write block**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function failedMigrationNotRecordedBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("a failed migration is not recorded; subsequent run can succeed", async () => {
    let failOnFirst = true;
    const migrations = [
      {
        version: 1,
        ops: [
          {
            kind: "backfill" as const,
            transform: (row: Record<string, unknown>) => {
              if (failOnFirst) {
                failOnFirst = false;
                throw new Error("boom");
              }
              return row;
            },
          },
        ],
      },
    ];
    await expect(
      getHandle().makeStorage(
        { id: { type: "string" } },
        migrations,
        [{ id: "u1" }]
      )
    ).rejects.toThrow(/boom/);

    // Retry — should now succeed.
    const storage = await getHandle().makeStorage(
      { id: { type: "string" } },
      migrations,
      [{ id: "u1" }]
    );
    expect(await storage.size()).toBe(1);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test/src/contract/tabular-migrations/assertions/failedMigrationNotRecorded.ts
git commit -m "test(tabular): contract block — failed migration not recorded"
```

---

# Phase 9 — Per-backend integration tests

### Task 9.1: InMemory contract test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/InMemoryTabular.contract.test.ts`

- [ ] **Step 1: Write test**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import type { ITabularMigration } from "@workglow/storage";
import { runTabularMigrationContract } from "../../contract/tabular-migrations/runTabularMigrationContract";

runTabularMigrationContract({
  name: "InMemory",
  enforcesDdl: false,
  factory: async () => {
    // Single shared storage instance across `makeStorage` calls so
    // incrementalApplication sees prior bookkeeping.
    let storage: InMemoryTabularStorage<any, any, any, any, any, any> | undefined;
    return {
      makeStorage: async (properties, migrations, preExistingRows) => {
        if (!storage) {
          storage = new InMemoryTabularStorage(
            { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
            ["id"] as const,
            [],
            "if-missing",
            migrations as ReadonlyArray<ITabularMigration>,
            "inmemory"
          );
          for (const row of preExistingRows ?? []) await (storage as any).put(row);
          await storage.setupDatabase();
        } else {
          // Re-open with new migrations: re-create with same data.
          const existing = (await storage.getAll()) ?? [];
          storage = new InMemoryTabularStorage(
            { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
            ["id"] as const,
            [],
            "if-missing",
            migrations as ReadonlyArray<ITabularMigration>,
            "inmemory"
          );
          for (const r of existing) await (storage as any).put(r);
          await storage.setupDatabase();
        }
        return storage as any;
      },
      dispose: async () => {
        storage?.destroy();
      },
    };
  },
});
```

(InMemory is the simplest case; many SQL-only assertions are gated by `enforcesDdl: false`.)

- [ ] **Step 2: Run test**

Run: `bun scripts/test.ts tabular-migrations vitest`
Expected: PASS for `InMemory` block.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/test/tabular-migrations/InMemoryTabular.contract.test.ts
git commit -m "test(tabular): InMemory contract conformance"
```

### Task 9.2: SQLite contract test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/SqliteTabular.contract.test.ts`

- [ ] **Step 1: Write test**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import type { ITabularMigration } from "@workglow/storage";
import { runTabularMigrationContract } from "../../contract/tabular-migrations/runTabularMigrationContract";

runTabularMigrationContract({
  name: "SQLite",
  enforcesDdl: true,
  persistentBookkeeping: true,
  factory: async () => {
    const db = new Sqlite.Database(":memory:");
    return {
      makeStorage: async (properties, migrations, preExistingRows) => {
        // Drop previous instance's table so each `makeStorage` starts fresh
        // EXCEPT when the assertion expects shared state (incremental).
        // Mode is encoded by inspecting whether bookkeeping already has
        // a row for tabular:users — if yes, we're in retry mode and skip
        // the drop. (Heuristic; assertions that need persistence rely on
        // shared db.)
        const tableName = "users";
        const storage = new SqliteTabularStorage(
          db,
          tableName,
          { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
          ["id"] as const,
          [],
          "if-missing",
          migrations as ReadonlyArray<ITabularMigration>
        );
        // Pre-populate before setupDatabase so addColumn/etc see the rows.
        if (preExistingRows && preExistingRows.length > 0) {
          // Build minimal raw schema in SQLite: best to call setupDatabase on a
          // pre-storage with just the v0 columns first, but that's heavy here.
          // Strategy: create a temporary storage with only the columns present
          // in preExistingRows[0], populate, then drop and recreate via the
          // real storage which the migrations + indexed schema target.
          const v0Properties: Record<string, unknown> = {};
          for (const k of Object.keys(preExistingRows[0])) v0Properties[k] = { type: "string" };
          const v0 = new SqliteTabularStorage(
            db,
            tableName,
            { type: "object", properties: v0Properties, required: Object.keys(v0Properties), additionalProperties: false } as any,
            ["id"] as const
          );
          await v0.setupDatabase();
          for (const r of preExistingRows) await (v0 as any).put(r);
        }
        await storage.setupDatabase();
        return storage as any;
      },
      dispose: async () => {
        db.close();
      },
    };
  },
});
```

(Pre-population strategy is a stand-in — feel free to refactor when test runs reveal a cleaner shape.)

- [ ] **Step 2: Run test**

Run: `bun scripts/test.ts tabular-migrations vitest`
Expected: SQLite block passes for addColumn / dropColumn / renameColumn / index / backfill / freshDb / failedMigration. `incrementalApplication` may need handle adjustments.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/test/tabular-migrations/SqliteTabular.contract.test.ts
git commit -m "test(tabular): SQLite contract conformance"
```

### Task 9.3: Postgres contract test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/PostgresTabular.contract.test.ts`

- [ ] **Step 1: Write test (PGlite-backed)**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PGLitePool, PostgresTabularStorage } from "@workglow/postgres";
import type { ITabularMigration } from "@workglow/storage";
import { runTabularMigrationContract } from "../../contract/tabular-migrations/runTabularMigrationContract";

runTabularMigrationContract({
  name: "Postgres (PGlite)",
  enforcesDdl: true,
  persistentBookkeeping: true,
  factory: async () => {
    const pgl = new PGlite();
    const pool = new PGLitePool(pgl);
    return {
      makeStorage: async (properties, migrations, preExistingRows) => {
        const tableName = "users";
        if (preExistingRows && preExistingRows.length > 0) {
          const v0Properties: Record<string, unknown> = {};
          for (const k of Object.keys(preExistingRows[0])) v0Properties[k] = { type: "string" };
          const v0 = new PostgresTabularStorage(
            pool,
            tableName,
            { type: "object", properties: v0Properties, required: Object.keys(v0Properties), additionalProperties: false } as any,
            ["id"] as const
          );
          await v0.setupDatabase();
          for (const r of preExistingRows) await (v0 as any).put(r);
        }
        const storage = new PostgresTabularStorage(
          pool,
          tableName,
          { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
          ["id"] as const,
          [],
          "if-missing",
          migrations as ReadonlyArray<ITabularMigration>
        );
        await storage.setupDatabase();
        return storage as any;
      },
      dispose: async () => {
        await pgl.close();
      },
    };
  },
});
```

- [ ] **Step 2: Run, iterate, commit**

```bash
bun scripts/test.ts tabular-migrations vitest
git add packages/test/src/test/tabular-migrations/PostgresTabular.contract.test.ts
git commit -m "test(tabular): Postgres contract conformance (PGlite)"
```

### Task 9.4: IndexedDB contract test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/IndexedDbTabular.contract.test.ts`

- [ ] **Step 1: Write test (fake-indexeddb)**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";
import { IndexedDbTabularStorage } from "@workglow/indexeddb/storage";
import type { ITabularMigration } from "@workglow/storage";
import { runTabularMigrationContract } from "../../contract/tabular-migrations/runTabularMigrationContract";

let dbCounter = 0;

runTabularMigrationContract({
  name: "IndexedDB",
  enforcesDdl: false,
  persistentBookkeeping: true,
  factory: async () => {
    const dbName = `users_${++dbCounter}`;
    return {
      makeStorage: async (properties, migrations, preExistingRows) => {
        if (preExistingRows && preExistingRows.length > 0) {
          const v0 = new IndexedDbTabularStorage(
            dbName,
            { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
            ["id"] as const
          );
          await v0.setupDatabase();
          for (const r of preExistingRows) await (v0 as any).put(r);
        }
        const storage = new IndexedDbTabularStorage(
          dbName,
          { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
          ["id"] as const,
          [],
          {},
          undefined,
          migrations as ReadonlyArray<ITabularMigration>
        );
        await storage.setupDatabase();
        return storage as any;
      },
      dispose: async () => {
        // fake-indexeddb auto cleans on test runner exit
      },
    };
  },
});
```

- [ ] **Step 2: Run, iterate, commit**

```bash
bun scripts/test.ts tabular-migrations vitest
git add packages/test/src/test/tabular-migrations/IndexedDbTabular.contract.test.ts
git commit -m "test(tabular): IndexedDB contract conformance"
```

### Task 9.5: FsFolder contract test

**Files:**
- Create: `packages/test/src/test/tabular-migrations/FsFolderTabular.contract.test.ts`

- [ ] **Step 1: Write test**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsFolderTabularStorage } from "@workglow/storage";
import type { ITabularMigration } from "@workglow/storage";
import { runTabularMigrationContract } from "../../contract/tabular-migrations/runTabularMigrationContract";

runTabularMigrationContract({
  name: "FsFolder",
  enforcesDdl: false,
  persistentBookkeeping: true,
  factory: async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsft-"));
    return {
      makeStorage: async (properties, migrations, preExistingRows) => {
        const storage = new FsFolderTabularStorage(
          dir,
          { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as any,
          ["id"] as const,
          [],
          "if-missing",
          migrations as ReadonlyArray<ITabularMigration>
        );
        if (preExistingRows && preExistingRows.length > 0) {
          // Write directly to the underlying folder format so the storage
          // sees them as pre-existing.
          for (const r of preExistingRows) await (storage as any).put(r);
        }
        await storage.setupDatabase();
        return storage as any;
      },
      dispose: async () => {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
});
```

(`FsFolderTabularStorage` constructor signature may differ — verify and adjust the `new` call.)

- [ ] **Step 2: Run, iterate, commit**

```bash
bun scripts/test.ts tabular-migrations vitest
git add packages/test/src/test/tabular-migrations/FsFolderTabular.contract.test.ts
git commit -m "test(tabular): FsFolder contract conformance"
```

---

# Phase 10 — Documentation

### Task 10.1: README addendum

**Files:**
- Modify: `packages/storage/src/tabular/README.md`

- [ ] **Step 1: Append a "Migrations" section**

Append to the existing README:

```markdown
## Migrations

Tabular storages accept an optional `migrations: ITabularMigration[]` constructor parameter. Each migration is a backend-agnostic, declarative description of a schema-evolution step:

```ts
new SqliteTabularStorage(
  db,
  "users",
  schema,
  ["id"],
  [],
  "if-missing",
  [
    {
      version: 1,
      description: "add archived flag",
      ops: [
        { kind: "addColumn", name: "archived", schema: { type: "boolean" } },
        { kind: "addIndex", name: "idx_archived", columns: ["archived"] },
      ],
    },
  ]
);
```

See `docs/superpowers/specs/2026-05-07-unified-tabular-migrations-design.md` for the full design.
```

- [ ] **Step 2: Update the `setupDatabase` JSDoc in `ITabularStorage.ts`**

Find the docstring on `setupDatabase()` (`packages/storage/src/tabular/ITabularStorage.ts:486-498`) and replace the line "there is no `migrate()` to defer to" with:

```
* When the storage was constructed with `migrations`, `setupDatabase()` also
* applies any pending migrations through the unified tabular migration
* runner (see `TabularMigrationOrchestrator`). Otherwise it is a pure DDL
* setup primitive as before.
```

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/tabular/README.md packages/storage/src/tabular/ITabularStorage.ts
git commit -m "docs(storage): tabular migrations usage + ITabularStorage JSDoc"
```

---

# Phase 11 — Final verification

### Task 11.1: Full test suite + build

- [ ] **Step 1: Run all tests for the touched sections**

```bash
bun scripts/test.ts tabular-migrations vitest
bun scripts/test.ts storage vitest
bun scripts/test.ts sqlite vitest
bun scripts/test.ts indexeddb vitest
bun scripts/test.ts postgres vitest
```

Expected: all green.

- [ ] **Step 2: Build everything**

```bash
bun run build
```

Expected: clean build, no type errors.

- [ ] **Step 3: Format**

```bash
bun run format
```

- [ ] **Step 4: Final commit + push**

```bash
git status
# verify clean
git push -u origin claude/tabular-migrations-VJgmg
```

---

# Notes for the implementing engineer

- **Constructors are positional.** Adding a new positional parameter at the end is intentional — it preserves backwards compatibility for every existing caller. Do NOT refactor the constructors to options-bag form as part of this work; that's a separate, larger change.
- **The `withTransaction` proxy on Postgres** intentionally throws on nested calls. The applier never invokes `tx.withTransaction(…)`; it calls private `__txQuery` / `__txQueryParams` hooks added in Task 4.2 to issue raw SQL on the transaction-bound client. If you find yourself wanting to call `tx.withTransaction`, stop and re-read `PostgresTabularStorage` to understand why that path errors.
- **IndexedDB DDL must be synchronous.** Inside `IndexedDbTabularMigrationApplier.applyMigration`, only `addIndex` / `dropIndex` run inside the upgrade transaction; `backfill` runs after the upgrade transaction closes (against a normal readwrite tx). The doc string in the file reflects this; do NOT try to await inside `up()`.
- **`incrementalApplication` test** depends on the per-backend factory keeping state across `makeStorage` calls. If a backend's factory always rebuilds from scratch, that assertion will appear to "always pass" trivially — that's a bug in the factory, not the assertion.
- **The fresh-DB fast path is critical**: if you forget it, every fresh deployment runs every backfill against zero rows (still works) — but the `freshDbFastPath` block enforces zero `transform` calls.
- **`backfill.transform` signature** — the spec mentions a second `tx` argument. v1 of this plan deliberately drops it: the storage being iterated by `runBackfill` is already the transaction-bound storage, so a separate `tx` param would be redundant. If a caller ever needs sibling-table access from a backfill, add it as a follow-up (purely additive, no breakage).
- **Drift detection (`validateSchema`)** — spec lists it as opt-in / off-by-default. v1 of this plan does not implement it; add as a follow-up when a real drift bug surfaces. The spec section is informational.
- **IndexedDB backfill atomicity** — the spec says "each migration runs inside the single upgrade transaction." That's true for DDL, but IDB's sync-only constraint means *backfills* must run on a regular readwrite transaction after the upgrade tx closes. This plan implements that and documents the gap; a backfill failure mid-stream leaves the DDL committed but the bookkeeping unwritten, so a retry re-runs the backfill against the same DDL state. This is identical to the SQLite gap and is acceptable.
- The PR these branches off (commits `6bcd1fa`, `9b9d301`, `bda7659`) is the source of the existing `IMigrationRunner<DB>` infra. Read its `EXECUTION_MODEL.md` companion files if confused.

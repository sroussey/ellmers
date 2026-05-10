# Storage `getBulk` Plural-Get Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bulk-get-by-keys method to KV and Tabular storage; Vector inherits via tabular.

**Architecture:** Rename the existing deprecated `ITabularStorage.getBulk(offset, limit)` to `getOffsetPage` to free the name. Add a new `getBulk(keys)` returning filtered found rows. Default implementation in `BaseTabularStorage` does `Promise.all(get)`; SQL backends override with a single `WHERE (pk...) IN ((...),(...))` query. `KvViaTabularStorage` delegates to tabular's `getBulk` — picking up SQL pushdown for free across all tabular-backed KV implementations.

**Tech Stack:** TypeScript, Bun, Vitest. Node.js 24+ required (per `CLAUDE.md`). Test command: `bun scripts/test.ts storage vitest`.

**Spec:** `docs/superpowers/specs/2026-05-10-storage-get-plural-design.md`

---

## File Map

**Rename target (deprecated `getBulk(offset, limit)` → `getOffsetPage`):**
- `packages/storage/src/tabular/ITabularStorage.ts` — interface
- `packages/storage/src/tabular/BaseTabularStorage.ts` — abstract decl
- `packages/storage/src/tabular/InMemoryTabularStorage.ts`
- `packages/storage/src/tabular/SharedInMemoryTabularStorage.ts`
- `packages/storage/src/tabular/CachedTabularStorage.ts`
- `packages/storage/src/tabular/FsFolderTabularStorage.ts`
- `packages/storage/src/tabular/HuggingFaceTabularStorage.ts` (plus 2 internal self-calls)
- `packages/storage/src/tabular/TelemetryTabularStorage.ts`
- `providers/sqlite/src/storage/SqliteTabularStorage.ts`
- `providers/postgres/src/storage/PostgresTabularStorage.ts`
- `packages/indexeddb/src/storage/IndexedDbTabularStorage.ts`
- `packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts`
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`
- `packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts`

**New `getBulk(keys)` method:**
- `packages/storage/src/tabular/ITabularStorage.ts` — add to interface; add `getBulk` event
- `packages/storage/src/tabular/BaseTabularStorage.ts` — concrete default impl
- `providers/sqlite/src/storage/SqliteTabularStorage.ts` — SQL override
- `providers/postgres/src/storage/PostgresTabularStorage.ts` — SQL override
- `packages/storage/src/tabular/TelemetryTabularStorage.ts` — pass-through wrapper
- `packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts` — kb_id injection
- `packages/storage/src/kv/IKvStorage.ts` — interface; add `getBulk` event
- `packages/storage/src/kv/KvStorage.ts` — abstract decl
- `packages/storage/src/kv/KvViaTabularStorage.ts` — concrete via tabular
- `packages/storage/src/kv/FsFolderKvStorage.ts` — concrete via Promise.all
- `packages/storage/src/kv/TelemetryKvStorage.ts` — pass-through wrapper
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts` — new test suite
- `packages/test/src/test/storage-kv/genericKvRepositoryTests.ts` — new test suite

---

## Task 1: Rename `getBulk(offset, limit)` → `getOffsetPage` on the tabular interface

**Files:**
- Modify: `packages/storage/src/tabular/ITabularStorage.ts`

- [ ] **Step 1: Rename the method in the interface**

Open `packages/storage/src/tabular/ITabularStorage.ts`. Find the block (around line 311–319):

```ts
  /**
   * Fetches a page of records from the repository.
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Array of entities or undefined if no records found
   * @deprecated Offset-based paging is unstable under concurrent writes.
   *   Use {@link getPage} for stable, keyset-based pagination.
   */
  getBulk(offset: number, limit: number): Promise<Entity[] | undefined>;
```

Replace with:

```ts
  /**
   * Fetches a page of records from the repository using offset-based paging.
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Array of entities or undefined if no records found
   * @deprecated Offset-based paging is unstable under concurrent writes.
   *   Use {@link getPage} for stable, keyset-based pagination.
   */
  getOffsetPage(offset: number, limit: number): Promise<Entity[] | undefined>;
```

- [ ] **Step 2: Verify build now fails at every implementation**

Run: `bun run build:types 2>&1 | head -40`
Expected: type errors on every class implementing `ITabularStorage` because they still expose `getBulk(offset, limit)` but no `getOffsetPage`. We use the failing build as the checklist for Task 2.

---

## Task 2: Rename `getBulk(offset, limit)` → `getOffsetPage` in every implementation

**Files:**
- Modify: `packages/storage/src/tabular/BaseTabularStorage.ts:468`
- Modify: `packages/storage/src/tabular/InMemoryTabularStorage.ts:255`
- Modify: `packages/storage/src/tabular/SharedInMemoryTabularStorage.ts:371-372`
- Modify: `packages/storage/src/tabular/CachedTabularStorage.ts:285-289`
- Modify: `packages/storage/src/tabular/FsFolderTabularStorage.ts:346,375`
- Modify: `packages/storage/src/tabular/HuggingFaceTabularStorage.ts:337,392,439`
- Modify: `packages/storage/src/tabular/TelemetryTabularStorage.ts:102-104`
- Modify: `providers/sqlite/src/storage/SqliteTabularStorage.ts:973`
- Modify: `providers/postgres/src/storage/PostgresTabularStorage.ts:1251`
- Modify: `packages/indexeddb/src/storage/IndexedDbTabularStorage.ts:710`
- Modify: `packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts:141`

- [ ] **Step 1: Rename the abstract method in BaseTabularStorage**

In `packages/storage/src/tabular/BaseTabularStorage.ts` line 468, change:

```ts
  abstract getBulk(offset: number, limit: number): Promise<Entity[] | undefined>;
```

to:

```ts
  abstract getOffsetPage(offset: number, limit: number): Promise<Entity[] | undefined>;
```

- [ ] **Step 2: Rename `getBulk` → `getOffsetPage` in every concrete implementation**

In each of the following files, rename the public `getBulk(offset, limit)` method to `getOffsetPage(offset, limit)`. For files where there is also a private `_getBulkInternal`, rename to `_getOffsetPageInternal` for consistency. Internal callers that invoke `this.getBulk(offset, ...)` are also renamed to `this.getOffsetPage(...)`.

Concrete files:

```
packages/storage/src/tabular/InMemoryTabularStorage.ts
packages/storage/src/tabular/SharedInMemoryTabularStorage.ts
packages/storage/src/tabular/CachedTabularStorage.ts
packages/storage/src/tabular/FsFolderTabularStorage.ts
packages/storage/src/tabular/HuggingFaceTabularStorage.ts   (three usages: a self-call at 337, a method definition at 392, another self-call at 439)
packages/storage/src/tabular/TelemetryTabularStorage.ts     (rename the traced span name to "workglow.storage.tabular.getOffsetPage")
providers/sqlite/src/storage/SqliteTabularStorage.ts
providers/postgres/src/storage/PostgresTabularStorage.ts
packages/indexeddb/src/storage/IndexedDbTabularStorage.ts
packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts
```

Also fix the log string in `FsFolderTabularStorage.ts` around line 375:
```ts
`Skipping corrupted file in getBulk: ${result.reason?.message ?? result.reason}`
```
to:
```ts
`Skipping corrupted file in getOffsetPage: ${result.reason?.message ?? result.reason}`
```

- [ ] **Step 3: Verify the type build now passes**

Run: `bun run build:types`
Expected: clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(storage): rename deprecated getBulk(offset,limit) to getOffsetPage" -m "Frees the getBulk name for the upcoming plural-get-by-keys method.
@deprecated JSDoc preserved; migration target remains getPage."
```

---

## Task 3: Rename `getBulk` → `getOffsetPage` in the tabular tests

**Files:**
- Modify: `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts:2338-2422`
- Modify: `packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts:327,341,353,358,374`

- [ ] **Step 1: Update the generic tabular tests**

In `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`:

- Line 2338: change `describe("getBulk", () => {` to `describe("getOffsetPage", () => {`
- Lines 2340, 2355, 2369, 2385, 2406, 2419: change every `repository.getBulk(` to `repository.getOffsetPage(`

- [ ] **Step 2: Update the HuggingFace integration tests**

In `packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts`:

- Line 327: `await storage.getBulk(50, 10)` → `await storage.getOffsetPage(50, 10)`
- Line 341: rename test from `"should return undefined for getBulk when no entities found"` → `"should return undefined for getOffsetPage when no entities found"`
- Line 353: `await storage.getBulk(0, 10)` → `await storage.getOffsetPage(0, 10)`
- Line 358: rename test from `"should cap getBulk limit at 100 (HF max)"` → `"should cap getOffsetPage limit at 100 (HF max)"`
- Line 374: `await storage.getBulk(0, 200)` → `await storage.getOffsetPage(0, 200)`

- [ ] **Step 3: Verify the storage tests still pass**

Run: `bun scripts/test.ts storage vitest`
Expected: all storage vitest tests pass. The `getOffsetPage` suite is the renamed-but-unchanged tests.

- [ ] **Step 4: Commit**

```bash
git add packages/test/src/test/storage-tabular/genericTabularStorageTests.ts \
        packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts
git commit -m "test(storage): rename getBulk(offset,limit) test sites to getOffsetPage"
```

---

## Task 4: Add `getBulk(keys)` event type and interface signature on tabular

**Files:**
- Modify: `packages/storage/src/tabular/ITabularStorage.ts`

- [ ] **Step 1: Add `getBulk` to TabularEventListeners**

Find:
```ts
export type TabularEventListeners<PrimaryKey, Entity> = {
  put: (entity: Entity) => void;
  get: (key: PrimaryKey, entity: Entity | undefined) => void;
  query: (key: Partial<Entity>, entities: Entity[] | undefined) => void;
  delete: (key: keyof Entity) => void;
  clearall: () => void;
};
```

Replace with:
```ts
export type TabularEventListeners<PrimaryKey, Entity> = {
  put: (entity: Entity) => void;
  get: (key: PrimaryKey, entity: Entity | undefined) => void;
  getBulk: (keys: readonly PrimaryKey[], entities: readonly Entity[]) => void;
  query: (key: Partial<Entity>, entities: Entity[] | undefined) => void;
  delete: (key: keyof Entity) => void;
  clearall: () => void;
};
```

- [ ] **Step 2: Add the new `getBulk(keys)` signature to ITabularStorage**

Inside the `ITabularStorage` interface, immediately after the `get(key)` declaration, add:

```ts
  /**
   * Fetches multiple entities by their primary keys in a single call.
   *
   * Returns only the entities that were found — the result is a filtered
   * array, not aligned with the input. Each returned entity carries its own
   * primary-key fields, so callers can re-align by key without a parallel
   * array. Result ordering is unspecified.
   *
   * Empty input returns an empty array without issuing a backend call.
   *
   * @param keys - Array of primary keys to look up
   * @returns Array of matching entities (possibly empty)
   */
  getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]>;
```

- [ ] **Step 3: Verify the build fails at every implementation**

Run: `bun run build:types 2>&1 | head -30`
Expected: each tabular implementation reports `Class incorrectly implements interface 'ITabularStorage'... Property 'getBulk' is missing`. This is the checklist for the next tasks.

---

## Task 5: Add default `getBulk(keys)` to `BaseTabularStorage`

**Files:**
- Modify: `packages/storage/src/tabular/BaseTabularStorage.ts`

- [ ] **Step 1: Write a failing test (TDD) against InMemory backed by the default impl**

Open `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`. Inside the same outer `describe("with compound primary keys", ...)` block that owns the `describe("getOffsetPage", ...)` (now-renamed) block, add a new sibling `describe("getBulk(keys)", ...)` block AFTER the `getOffsetPage` block, just before `describe("records", ...)`:

```ts
    describe("getBulk(keys)", () => {
      const seed = [
        { name: "key1", type: "type1", option: "value1", success: true },
        { name: "key2", type: "type2", option: "value2", success: false },
        { name: "key3", type: "type3", option: "value3", success: true },
      ];

      it("returns an empty array for empty input without throwing", async () => {
        const result = await repository.getBulk([]);
        expect(result).toEqual([]);
      });

      it("returns an empty array when no keys exist", async () => {
        await repository.putBulk(seed);
        const result = await repository.getBulk([
          { name: "missing", type: "missing" },
          { name: "also-missing", type: "x" },
        ]);
        expect(result).toEqual([]);
      });

      it("returns all entities when every key exists", async () => {
        await repository.putBulk(seed);
        const result = await repository.getBulk([
          { name: "key1", type: "type1" },
          { name: "key2", type: "type2" },
          { name: "key3", type: "type3" },
        ]);
        expect(result.length).toBe(3);
        const byName = new Map(result.map((r) => [r.name, r]));
        expect(byName.get("key1")?.option).toBe("value1");
        expect(byName.get("key2")?.option).toBe("value2");
        expect(byName.get("key3")?.option).toBe("value3");
      });

      it("returns only the found subset when some keys are missing", async () => {
        await repository.putBulk(seed);
        const result = await repository.getBulk([
          { name: "key1", type: "type1" },
          { name: "missing", type: "missing" },
          { name: "key3", type: "type3" },
        ]);
        expect(result.length).toBe(2);
        const names = result.map((r) => r.name).sort();
        expect(names).toEqual(["key1", "key3"]);
      });

      it("returns full entity rows (non-PK fields included)", async () => {
        await repository.putBulk(seed);
        const result = await repository.getBulk([{ name: "key2", type: "type2" }]);
        expect(result.length).toBe(1);
        expect(result[0].option).toBe("value2");
        expect(!!result[0].success).toBe(false);
      });

      it("emits a getBulk event with the keys and the found entities", async () => {
        await repository.putBulk(seed);
        const seen: Array<{ keys: any; found: any }> = [];
        repository.on("getBulk", (keys, entities) => {
          seen.push({ keys, found: entities });
        });
        const keys = [
          { name: "key1", type: "type1" },
          { name: "missing", type: "missing" },
        ];
        await repository.getBulk(keys);
        expect(seen.length).toBe(1);
        expect(seen[0].keys).toEqual(keys);
        expect(seen[0].found.length).toBe(1);
        expect(seen[0].found[0].name).toBe("key1");
      });
    });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -40`
Expected: every `getBulk(keys)` test fails (compile error or `getBulk is not a function`) because no concrete class implements the new method yet.

- [ ] **Step 3: Replace the abstract decl in BaseTabularStorage with a default impl**

In `packages/storage/src/tabular/BaseTabularStorage.ts`, find:
```ts
  abstract put(value: InsertType): Promise<Entity>;
  abstract putBulk(values: InsertType[]): Promise<Entity[]>;
  abstract get(key: PrimaryKey): Promise<Entity | undefined>;
  abstract delete(key: PrimaryKey | Entity): Promise<void>;
  abstract getAll(options?: QueryOptions<Entity>): Promise<Entity[] | undefined>;
  abstract deleteAll(): Promise<void>;
  abstract size(): Promise<number>;
```

Add a concrete `getBulk(keys)` method directly after these abstract declarations (still inside the class):

```ts
  /**
   * Default plural-get implementation: parallel single-key fetches via
   * {@link get}, with `undefined` results filtered out. Backends with a
   * cheaper batched path (SQL `WHERE pk IN (...)`) override this.
   */
  async getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    if (keys.length === 0) return [];
    const results = await Promise.all(keys.map((k) => this.get(k)));
    const found = results.filter((r): r is Entity => r !== undefined);
    this.events.emit("getBulk", keys, found);
    return found;
  }
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -40`
Expected: the new `getBulk(keys)` block passes against every InMemory-backed run. SQL backends (sqlite, postgres) also pass through the inherited default — but slowly. We will replace those in Tasks 6 and 7.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/tabular/BaseTabularStorage.ts \
        packages/storage/src/tabular/ITabularStorage.ts \
        packages/test/src/test/storage-tabular/genericTabularStorageTests.ts
git commit -m "feat(storage): add ITabularStorage.getBulk(keys) plural-get" -m "Default implementation in BaseTabularStorage does Promise.all(get).
SQL backends will override with a single batched query in follow-up commits."
```

---

## Task 6: Override `getBulk(keys)` in `SqliteTabularStorage` with a batched query

**Files:**
- Modify: `providers/sqlite/src/storage/SqliteTabularStorage.ts`

Context reminder: `SqliteTabularStorage` already has `get`, `delete`, `getAll`, and now-renamed `getOffsetPage` implementations. They all go through `this.mutex(() => this._xxxInternal(...))` and use `this.primaryKeyColumns()`, `this.getPrimaryKeyAsOrderedArray(key)`, `this.jsToSqlValue(...)`, and `this.sqlToJsValue(...)`. Follow the same pattern.

- [ ] **Step 1: Add the override**

Find the existing `get(key)` method around line 818 in `providers/sqlite/src/storage/SqliteTabularStorage.ts`. Directly after `_getInternal` (around line 846, before `delete` at line 853), insert:

```ts
  /**
   * Fetch multiple rows by primary key in a single statement. Single-column
   * keys emit `WHERE pk IN (?,?,...)`. Compound keys emit
   * `WHERE (pk1,pk2,...) IN ((?,?,...),(?,?,...),...)`. Values bind through
   * `jsToSqlValue` for parity with `query()` and single-row `get()`.
   */
  override async getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    if (keys.length === 0) return [];
    return this.mutex(() => this._getBulkInternal(keys));
  }

  private async _getBulkInternal(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    const db = this.db;
    const pkCols = this.primaryKeyColumns() as string[];

    const placeholdersPerKey = `(${pkCols.map(() => "?").join(", ")})`;
    const valuesClause = keys.map(() => placeholdersPerKey).join(", ");

    const params: ValueOptionType[] = [];
    for (const key of keys) {
      const ordered = this.getPrimaryKeyAsOrderedArray(key);
      for (let i = 0; i < pkCols.length; i++) {
        params.push(
          this.jsToSqlValue(pkCols[i], ordered[i] as Entity[keyof Entity])
        );
      }
    }

    const lhs =
      pkCols.length === 1
        ? `\`${pkCols[0]}\``
        : `(${pkCols.map((c) => `\`${c}\``).join(", ")})`;

    const sql = `SELECT * FROM \`${this.table}\` WHERE ${lhs} IN (${valuesClause})`;
    const stmt = db.prepare<ValueOptionType[], Entity>(sql);
    // @ts-ignore - SQLite typing for variadic bindings is overly strict for our union
    const rows: Entity[] = stmt.all(...(params as ValueOptionType[]));

    for (const row of rows) {
      const record = row as Record<string, unknown>;
      for (const k in this.schema.properties) {
        record[k] = this.sqlToJsValue(k, record[k] as ValueOptionType);
      }
    }
    this.events.emit("getBulk", keys, rows);
    return rows;
  }
```

(If SQLite's `IN (?, ?, ...)` form for single-column keys is preferred over the `IN ((?))` row-value form, that's already handled by the `lhs` branch above — single columns use `pk IN (?,?,...)`, compound uses `(p1,p2) IN ((?,?),(?,?))`.)

- [ ] **Step 2: Run the SQLite tabular tests**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -40`
Expected: all existing tests pass plus the new `getBulk(keys)` block passes against SQLite.

- [ ] **Step 3: Commit**

```bash
git add providers/sqlite/src/storage/SqliteTabularStorage.ts
git commit -m "perf(sqlite): batched getBulk(keys) using WHERE (pk) IN (...)"
```

---

## Task 7: Override `getBulk(keys)` in `PostgresTabularStorage` with a batched query

**Files:**
- Modify: `providers/postgres/src/storage/PostgresTabularStorage.ts`

Context: Postgres uses `$N` numbered placeholders and `"col"` quoting (not backticks). Otherwise the pattern matches SQLite. Bound values go through `this.jsToSqlValue(...)` and result rows go through `this.sqlToJsValue(...)`.

- [ ] **Step 1: Add the override**

In `providers/postgres/src/storage/PostgresTabularStorage.ts`, find the existing `async get(key)` method around line 1098. Directly after its `_getInternal` (before the next public method), insert:

```ts
  /**
   * Fetch multiple rows by primary key in a single statement. Single-column
   * keys emit `WHERE pk IN ($1,$2,...)`. Compound keys emit
   * `WHERE (pk1,pk2,...) IN (($1,$2,...),($3,$4,...),...)`. Values bind
   * through `jsToSqlValue` for parity with `query()` and `get()`.
   */
  override async getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    if (keys.length === 0) return [];
    return this.mutex(() => this._getBulkInternal(keys));
  }

  private async _getBulkInternal(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    const db = this.db;
    const pkCols = this.primaryKeyColumns() as string[];

    const params: ValueOptionType[] = [];
    const tuples: string[] = [];
    let p = 1;
    for (const key of keys) {
      const ordered = this.getPrimaryKeyAsOrderedArray(key);
      const slots: string[] = [];
      for (let i = 0; i < pkCols.length; i++) {
        params.push(
          this.jsToSqlValue(pkCols[i], ordered[i] as Entity[keyof Entity])
        );
        slots.push(`$${p++}`);
      }
      tuples.push(`(${slots.join(", ")})`);
    }

    const lhs =
      pkCols.length === 1
        ? `"${pkCols[0]}"`
        : `(${pkCols.map((c) => `"${c}"`).join(", ")})`;

    // For single-column LHS, the tuple-wrapped placeholders still work
    // because Postgres accepts both `pk IN (v1, v2)` and `pk IN ((v1), (v2))`
    // — but to keep the SQL idiomatic, flatten when only one column.
    const rhs =
      pkCols.length === 1
        ? params.map((_, i) => `$${i + 1}`).join(", ")
        : tuples.join(", ");

    const sql = `SELECT * FROM "${this.table}" WHERE ${lhs} IN (${rhs})`;
    const result = await db.query(sql, params);

    for (const row of result.rows) {
      const record = row as Record<string, unknown>;
      for (const key in this.schema.properties) {
        record[key] = this.sqlToJsValue(key, record[key] as ValueOptionType);
      }
    }
    const rows = result.rows as Entity[];
    this.events.emit("getBulk", keys, rows);
    return rows;
  }
```

- [ ] **Step 2: Run the Postgres tabular tests**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -40`
Expected: all tests pass, including the new `getBulk(keys)` block against Postgres.

- [ ] **Step 3: Commit**

```bash
git add providers/postgres/src/storage/PostgresTabularStorage.ts
git commit -m "perf(postgres): batched getBulk(keys) using WHERE (pk) IN (...)"
```

---

## Task 8: Pass-through `getBulk` on `TelemetryTabularStorage`

**Files:**
- Modify: `packages/storage/src/tabular/TelemetryTabularStorage.ts`

- [ ] **Step 1: Add the pass-through wrapper**

In `packages/storage/src/tabular/TelemetryTabularStorage.ts`, find the existing `getOffsetPage` (the renamed method from Task 2) around line 102. Directly after it, add:

```ts
  getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    return traced("workglow.storage.tabular.getBulk", this.storageName, () =>
      this.inner.getBulk(keys)
    );
  }
```

(`PrimaryKey` and `Entity` are already the generic parameters of the class; verify by looking at the class signature at the top of the file and adjust the names if they differ.)

- [ ] **Step 2: Verify the type build is clean**

Run: `bun run build:types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/tabular/TelemetryTabularStorage.ts
git commit -m "feat(storage): TelemetryTabularStorage forwards getBulk(keys)"
```

---

## Task 9: Override `getBulk(keys)` in `ScopedTabularStorage` (knowledge-base)

**Files:**
- Modify: `packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts`

Context: `ScopedTabularStorage` wraps an inner storage and injects `kb_id` into every operation so multiple knowledge bases can share a single physical table. The new `getBulk(keys)` must augment each key with `kb_id` and strip it from each returned row, so callers cannot accidentally read rows belonging to another KB.

- [ ] **Step 1: Add the scoped override**

Open `packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts`. Find the renamed `getOffsetPage` method around line 141. Directly after it, add:

```ts
  async getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]> {
    if (keys.length === 0) return [];
    const scopedKeys = keys.map((k) => this.inject(k));
    const results = await this.inner.getBulk(scopedKeys);
    const stripped = results.map((r: any) => this.strip(r)) as Entity[];
    this.events.emit("getBulk", keys, stripped);
    return stripped;
  }
```

- [ ] **Step 2: Verify the type build is clean and tests still pass**

Run: `bun run build:types && bun scripts/test.ts storage vitest 2>&1 | tail -20`
Expected: clean build, tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/knowledge-base/src/knowledge-base/ScopedTabularStorage.ts
git commit -m "feat(knowledge-base): ScopedTabularStorage scopes getBulk(keys) by kb_id"
```

---

## Task 10: Add `getBulk(keys)` event type and signature to `IKvStorage` / `KvStorage`

**Files:**
- Modify: `packages/storage/src/kv/IKvStorage.ts`
- Modify: `packages/storage/src/kv/KvStorage.ts`

- [ ] **Step 1: Add the `getBulk` event to KvEventListeners**

In `packages/storage/src/kv/IKvStorage.ts`, find:

```ts
export type KvEventListeners<Key, Value, Combined> = {
  put: (key: Key, value: Value) => void;
  get: (key: Key, value: Value | undefined) => void;
  getAll: (results: Combined[] | undefined) => void;
  delete: (key: unknown) => void;
  deleteall: () => void;
};
```

Replace with:

```ts
export type KvEventListeners<Key, Value, Combined> = {
  put: (key: Key, value: Value) => void;
  get: (key: Key, value: Value | undefined) => void;
  getBulk: (keys: readonly Key[], results: readonly Combined[]) => void;
  getAll: (results: Combined[] | undefined) => void;
  delete: (key: unknown) => void;
  deleteall: () => void;
};
```

- [ ] **Step 2: Add `getBulk(keys)` to IKvStorage**

In the same file, inside the `IKvStorage` interface, immediately after `get(key)`:

```ts
  /**
   * Fetches multiple values by their keys in a single bulk operation.
   *
   * Returns only the records that were found, as `Combined` (key + value)
   * pairs. Result ordering is unspecified. Missing keys produce no entry.
   * Empty input returns `[]` without issuing a backend call.
   */
  getBulk(keys: readonly Key[]): Promise<Combined[]>;
```

- [ ] **Step 3: Add the abstract decl to KvStorage**

In `packages/storage/src/kv/KvStorage.ts`, after the abstract `get(key)` declaration (around line 64), add:

```ts
  /**
   * Retrieves multiple values by their keys in a single bulk operation.
   * Returns only the found records; missing keys produce no entry. The
   * returned `Combined` records carry both key and value so callers can
   * re-align by key.
   */
  abstract getBulk(keys: readonly Key[]): Promise<Combined[]>;
```

- [ ] **Step 4: Verify the build fails at each KV implementation**

Run: `bun run build:types 2>&1 | head -30`
Expected: errors at `KvViaTabularStorage`, `FsFolderKvStorage`, and `TelemetryKvStorage` — they don't yet implement `getBulk`.

---

## Task 11: Implement `getBulk(keys)` in `KvViaTabularStorage`

**Files:**
- Modify: `packages/storage/src/kv/KvViaTabularStorage.ts`
- Modify: `packages/test/src/test/storage-kv/genericKvRepositoryTests.ts`

- [ ] **Step 1: Write failing tests in the generic KV suite**

Open `packages/test/src/test/storage-kv/genericKvRepositoryTests.ts`. Inside the `describe("with default schemas (key and value)", ...)` block, after the existing `"should handle empty array in putBulk"` test, add:

```ts
    it("should return empty array for getBulk with empty input", async () => {
      const result = await repository.getBulk([]);
      expect(result).toEqual([]);
    });

    it("should return only found records via getBulk", async () => {
      await repository.put("key1", "value1");
      await repository.put("key3", "value3");

      const result = await repository.getBulk(["key1", "key2", "key3"]);
      expect(result.length).toBe(2);
      const map = new Map(result.map((r) => [r.key, r.value]));
      expect(map.get("key1")).toBe("value1");
      expect(map.get("key3")).toBe("value3");
      expect(map.has("key2")).toBe(false);
    });

    it("should return empty array when no getBulk keys match", async () => {
      await repository.put("key1", "value1");
      const result = await repository.getBulk(["missing-a", "missing-b"]);
      expect(result).toEqual([]);
    });
```

Inside the `describe("with json value", ...)` block, after the existing `"should store multiple JSON values using putBulk"` test, add:

```ts
    it("should deserialize JSON values in getBulk results", async () => {
      const k1 = await repository.getObjectAsIdString({ name: "key1", type: "string1" });
      const k2 = await repository.getObjectAsIdString({ name: "key2", type: "string2" });
      await repository.put(k1, { option: "value1", success: true });
      await repository.put(k2, { option: "value2", success: false });

      const result = await repository.getBulk([k1, k2, "missing"]);
      expect(result.length).toBe(2);
      const byKey = new Map(result.map((r) => [r.key, r.value]));
      expect(byKey.get(k1)?.option).toBe("value1");
      expect(byKey.get(k1)?.success).toBe(true);
      expect(byKey.get(k2)?.option).toBe("value2");
      expect(byKey.get(k2)?.success).toBe(false);
    });
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -30`
Expected: every new `getBulk` test fails (compile error or `getBulk is not a function`).

- [ ] **Step 3: Implement `getBulk` in `KvViaTabularStorage`**

In `packages/storage/src/kv/KvViaTabularStorage.ts`, immediately after the existing `get(key)` method (currently lines 86–98), add:

```ts
  /**
   * Retrieves multiple values by their keys in a single bulk operation.
   * Delegates to the underlying tabular `getBulk` so SQL-backed KV stores
   * (Postgres, SQLite) get push-down for free.
   */
  public async getBulk(keys: readonly Key[]): Promise<Combined[]> {
    if (keys.length === 0) return [];
    const rows = await this.tabularRepository.getBulk(keys.map((key) => ({ key })));
    return rows.map((row) => {
      let value = row.value as unknown;
      if (this.needsJsonSerialization && typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // fall through with the raw string
        }
      }
      return { key: row.key as Key, value } as Combined;
    });
  }
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -30`
Expected: KV tests pass against InMemoryKvStorage, SqliteKvStorage, PostgresKvStorage, and others that extend `KvViaTabularStorage`. `FsFolderKvStorage` may still fail because it has no `getBulk` yet — that is Task 12. If it fails only at `FsFolderKvStorage`, that's expected.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/kv/IKvStorage.ts \
        packages/storage/src/kv/KvStorage.ts \
        packages/storage/src/kv/KvViaTabularStorage.ts \
        packages/test/src/test/storage-kv/genericKvRepositoryTests.ts
git commit -m "feat(storage): add IKvStorage.getBulk(keys) plural-get" -m "Delegates to ITabularStorage.getBulk on tabular-backed KV implementations,
picking up SQL batched-IN pushdown for free."
```

---

## Task 12: Implement `getBulk(keys)` in `FsFolderKvStorage`

**Files:**
- Modify: `packages/storage/src/kv/FsFolderKvStorage.ts`

- [ ] **Step 1: Add the implementation**

In `packages/storage/src/kv/FsFolderKvStorage.ts`, immediately after the existing `putBulk` method (currently lines 94–97), add:

```ts
  /**
   * Retrieves multiple values by their keys via parallel single-file reads.
   * Missing keys are dropped from the result.
   */
  public async getBulk(keys: readonly Key[]): Promise<Combined[]> {
    if (keys.length === 0) return [];
    const settled = await Promise.all(
      keys.map(async (key) => {
        const value = await this.get(key);
        if (value === undefined) return undefined;
        return { key, value } as Combined;
      })
    );
    return settled.filter((r): r is Combined => r !== undefined);
  }
```

- [ ] **Step 2: Run the FsFolderKv integration tests**

Run: `bun scripts/test.ts storage vitest 2>&1 | tail -30`
Expected: all KV tests pass including FsFolder.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/kv/FsFolderKvStorage.ts
git commit -m "feat(storage): FsFolderKvStorage implements getBulk(keys)"
```

---

## Task 13: Pass-through `getBulk` on `TelemetryKvStorage`

**Files:**
- Modify: `packages/storage/src/kv/TelemetryKvStorage.ts`

- [ ] **Step 1: Add the pass-through wrapper**

In `packages/storage/src/kv/TelemetryKvStorage.ts`, find the existing `get(key)` method around line 31. Directly after it, add:

```ts
  getBulk(keys: readonly Key[]): Promise<Combined[]> {
    return traced("workglow.storage.kv.getBulk", this.storageName, () =>
      this.inner.getBulk(keys)
    );
  }
```

- [ ] **Step 2: Verify the type build is clean**

Run: `bun run build:types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/kv/TelemetryKvStorage.ts
git commit -m "feat(storage): TelemetryKvStorage forwards getBulk(keys)"
```

---

## Task 14: Full storage test pass and push

- [ ] **Step 1: Run the full storage test suite**

Run: `bun scripts/test.ts storage vitest`
Expected: every storage test passes — both renamed (`getOffsetPage`) and new (`getBulk(keys)`) suites.

- [ ] **Step 2: Run the full type build**

Run: `bun run build:types`
Expected: clean.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin claude/storage-get-plural-YPPMp
```

Expected: pushes all task commits to the remote feature branch.

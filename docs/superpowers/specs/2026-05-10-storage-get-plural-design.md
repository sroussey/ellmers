# Storage: plural `getBulk` — design

Date: 2026-05-10
Branch: `claude/storage-get-plural-YPPMp`

## Goal

Add a bulk-get-by-keys method to KV, Tabular, and (free, via inheritance) Vector
storage. KV's `IKvStorage` and Tabular's `ITabularStorage` already expose
`putBulk`; this is the symmetric read.

The motivating use case is fetching N rows by primary key in one call instead of
N round-trips — both with simple keys (`[id1, id2, id3]` for KV) and compound
keys (`[{u,p,id}, {u,p,id}, ...]` for Tabular).

## API

### `IKvStorage`

```ts
getBulk(keys: readonly Key[]): Promise<Combined[]>;
```

- Returns only the records that were found, as `{key, value}` pairs (`Combined`).
- Order of results is unspecified. Missing keys produce no slot.
- Empty input returns `[]` without error.
- JSON-serialized values are deserialized in the returned `value`, matching
  single-key `get`.

`Combined` is preserved (rather than a flat `Value[]`) so callers can re-align
by key when needed; a bare `Value[]` would lose that linkage given filtered
output.

### `ITabularStorage`

```ts
getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]>;
```

- Returns only the entities that were found.
- Each `Entity` already carries its own primary-key fields, so callers can
  re-align by key without a separate parallel array.
- Order of results is unspecified.
- Empty input returns `[]` without error.

### `IVectorStorage`

No change — inherits the new `getBulk(keys)` from `ITabularStorage`.

### Events

A new `getBulk` event is added to both `KvEventListeners` and
`TabularEventListeners`, emitted after each successful call.

KV:
```ts
getBulk: (keys: readonly Key[], results: readonly Combined[]) => void;
```

Tabular:
```ts
getBulk: (keys: readonly PrimaryKey[], results: readonly Entity[]) => void;
```

Mirrors the existing per-method events (`put`, `get`, `query`).

## Naming reclaim

`ITabularStorage` currently exposes a deprecated
`getBulk(offset: number, limit: number): Promise<Entity[] | undefined>` that
points callers at `getPage` as the migration target. To free the name for the
new keys-based method, this is renamed to **`getOffsetPage(offset, limit)`**.
The `@deprecated` JSDoc is preserved; its migration target remains `getPage`.

This is a mechanical rename across the interface, every implementation, and the
two test files that exercise the deprecated method:

- `packages/storage/src/tabular/ITabularStorage.ts`
- `packages/storage/src/tabular/BaseTabularStorage.ts`
- `packages/storage/src/tabular/InMemoryTabularStorage.ts`
- `packages/storage/src/tabular/SharedInMemoryTabularStorage.ts`
- `packages/storage/src/tabular/CachedTabularStorage.ts`
- `packages/storage/src/tabular/HuggingFaceTabularStorage.ts` (plus internal self-calls)
- `packages/storage/src/tabular/FsFolderTabularStorage.ts`
- `packages/storage/src/tabular/TelemetryTabularStorage.ts`
- `providers/postgres/src/storage/PostgresTabularStorage.ts`
- `providers/sqlite/src/storage/SqliteTabularStorage.ts`
- `packages/indexeddb/src/storage/IndexedDbTabularStorage.ts`
- `packages/test/src/test/storage-tabular/genericTabularStorageTests.ts`
- `packages/test/src/test/storage-tabular/HuggingFaceTabularStorage.integration.test.ts`

## Implementation

### `BaseTabularStorage` (default)

Provides a generic implementation that all non-SQL backends inherit:

```ts
async getBulk(keys: readonly PrimaryKey[]): Promise<Entity[]> {
  if (keys.length === 0) return [];
  const results = await Promise.all(keys.map((k) => this.get(k)));
  const found = results.filter((r): r is Entity => r !== undefined);
  this.emit("getBulk", keys, found);
  return found;
}
```

This is correct for every backend but issues N round-trips on remote stores.
SQL backends override.

### `SqliteTabularStorage` and `PostgresTabularStorage`

Override `getBulk` with a single batched query:

- **Single-column PK** — `SELECT ... WHERE pk IN (?,?,...)`.
- **Compound PK** — `SELECT ... WHERE (pk1,pk2,...) IN ((?,?,...),(?,?,...),...)`.
- Values are bound through the same `jsToSqlValue` path used by `query()`, so
  Date / typed columns round-trip identically to a single `get`.
- Empty input short-circuits to `[]` without issuing SQL.
- Result row order is not specified — the SQL doesn't `ORDER BY` and the API
  contract is unordered.

### `KvStorage` (abstract)

Gets an abstract method to force every KV implementation to declare its own
behaviour or inherit from `KvViaTabularStorage`:

```ts
abstract getBulk(keys: readonly Key[]): Promise<Combined[]>;
```

### `KvViaTabularStorage` (default for tabular-backed KV)

Delegates to the underlying tabular `getBulk`, picking up SQL pushdown for free
on Postgres/Sqlite/IndexedDB-via-tabular:

```ts
async getBulk(keys: readonly Key[]): Promise<Combined[]> {
  if (keys.length === 0) return [];
  const rows = await this.tabularRepository.getBulk(keys.map((key) => ({ key })));
  const combined = rows.map((row) => ({
    key: row.key,
    value: this.needsJsonSerialization ? tryParseJson(row.value) : row.value,
  })) as Combined[];
  this.emit("getBulk", keys, combined);
  return combined;
}
```

The JSON deserialization step reuses the same `try { JSON.parse(...) } catch
{ return raw }` pattern already used by `get` and `getAll` in
`KvViaTabularStorage` — extracted into a small private helper to avoid
duplicating it three times.

### `FsFolderKvStorage`

```ts
async getBulk(keys: readonly Key[]): Promise<Combined[]> {
  if (keys.length === 0) return [];
  const results = await Promise.all(
    keys.map(async (key) => {
      const value = await this.get(key);
      return value === undefined ? undefined : ({ key, value } as Combined);
    })
  );
  return results.filter((r): r is Combined => r !== undefined);
}
```

### `TelemetryKvStorage` and `TelemetryTabularStorage`

Pass-through wrapper that adds a span:

```ts
getBulk(keys) {
  return traced("workglow.storage.kv.getBulk", this.storageName, () =>
    this.inner.getBulk(keys)
  );
}
```

(Same shape for tabular.)

## Tests

### `genericKvRepositoryTests.ts`

Add cases under both schema variants (default and JSON-object):

- All keys exist → returns all matching `{key, value}` records (length === input length).
- Subset missing → returns only the found records.
- All missing → returns `[]`.
- Empty input → returns `[]`, no error.
- JSON values are deserialized in returned `value`.

### `genericTabularStorageTests.ts`

Run against every tabular backend (in-memory, SQLite, Postgres, IndexedDB,
Supabase, FsFolder, ...):

- Single-column PK: all-found, partial, none-found, empty input.
- Compound PK: all-found and partial. Reuse an existing compound-PK schema in
  the file if one exists, otherwise add a small one alongside the new tests.
- Returned entities contain full row data (including non-PK columns).

### Renames

In `genericTabularStorageTests.ts` and `HuggingFaceTabularStorage.integration.test.ts`,
replace existing `getBulk(offset, limit)` call sites with `getOffsetPage(offset, limit)`.

No SQL-query-count assertion — pushdown is verified by code review of the
SqliteTabularStorage / PostgresTabularStorage overrides, not by inspecting bound
statements at the test level. This keeps the generic tests backend-agnostic.

## Out of scope

- Removing the deprecated `getOffsetPage` entirely — separate decision.
- Native IndexedDB batched-cursor `getBulk` override — the default `Promise.all`
  loop within a single transaction is already close to optimal there.
- An aligned-array (`(Entity | undefined)[]`) variant — explicitly chosen
  against; filtered output is the contract.
- A `Map<Key, Value>` return shape — awkward for compound keys.
- A symmetric bulk-delete-by-keys (`deleteBulk`). Useful, but a separate task.

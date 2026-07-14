# @workglow/duckdb

DuckDB backends for @workglow/storage.

## Features

- DuckDB implementation of the `ITabularStorage` interface (`DuckDbTabularStorage`)
- File-based or in-memory databases
- Upserts via `INSERT … ON CONFLICT … RETURNING *`
- Sequence-backed auto-increment keys and client-generated UUID keys
- Cursor pagination, covering-index queries, transactions, and versioned tabular migrations

## Installation

```bash
npm install @workglow/duckdb @duckdb/node-api
# or
bun add @workglow/duckdb @duckdb/node-api
```

`@duckdb/node-api` is an optional peer dependency: it is loaded lazily on
first use, so bundling `@workglow/duckdb` does not pull DuckDB into builds
that never open a database. DuckDB storage runs on Node.js and Bun (there is
no browser support).

## Usage

```typescript
import { DuckDbTabularStorage } from "@workglow/duckdb/storage";

const storage = new DuckDbTabularStorage(
  "analytics.duckdb", // or ":memory:", or an already-open DuckDbDatabase
  "events",
  schema,
  ["id"] as const,
  [["kind", "createdAt"]] as const // secondary indexes
);
await storage.setupDatabase();

await storage.put({ id: "e1", kind: "click", createdAt: new Date().toISOString() });
const rows = await storage.query({ kind: "click" });
```

To share one database across several tables, construct each storage with the
same path — file-backed opens go through DuckDB's per-path instance cache, so
the storages share one database while each gets its own connection (and
therefore its own transaction context):

```typescript
const events = new DuckDbTabularStorage("analytics.duckdb", "events", eventSchema, ["id"] as const);
const users = new DuckDbTabularStorage("analytics.duckdb", "users", userSchema, ["id"] as const);
```

You can also open a handle yourself with `DuckDb.open(path)` and pass it in —
but a single `DuckDbDatabase` carries a single connection, so storages sharing
one handle share one transaction context: another storage's write issued while
a `withTransaction` is open on the same handle joins that transaction and rolls
back with it. Only share a handle across storages that never use
`withTransaction`/`putBulk` concurrently; otherwise prefer the same-path
pattern above.

## Notes

- DuckDB is an embedded engine; each storage instance serializes its own
  operations, and `withTransaction` runs `BEGIN`/`COMMIT` on the storage's
  connection (mirroring the SQLite backend).
- `destroy()` closes the database handle when the storage opened it from a
  path; caller-provided handles are closed by the caller via `db.close()`.
- The SQL dialect is Postgres-shaped (double-quoted identifiers, `$N`
  placeholders), so query semantics match the Postgres backend.
- `subscribeToChanges` is not supported (same as the SQLite and Postgres
  backends).

## License

Apache 2.0

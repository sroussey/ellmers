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

To share one database across several tables, open the handle once and pass it
to each storage:

```typescript
import { DuckDb } from "@workglow/duckdb/storage";

const db = await DuckDb.open("analytics.duckdb");
const events = new DuckDbTabularStorage(db, "events", eventSchema, ["id"] as const);
const users = new DuckDbTabularStorage(db, "users", userSchema, ["id"] as const);
```

## Notes

- DuckDB is an embedded single-connection engine; each storage instance
  serializes its operations, and `withTransaction` runs `BEGIN`/`COMMIT` on
  the shared connection (mirroring the SQLite backend).
- The SQL dialect is Postgres-shaped (double-quoted identifiers, `$N`
  placeholders), so query semantics match the Postgres backend.
- `subscribeToChanges` is not supported (same as the SQLite and Postgres
  backends).

## License

Apache 2.0

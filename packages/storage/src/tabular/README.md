# Tabular Repository Implementations

A collection of storage implementations for tabular data with multiple backend support. Provides consistent CRUD operations, search capabilities, and event monitoring across different storage technologies.

- [Features](#features)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Schema Definitions](#schema-definitions)
  - [Using TypeBox](#using-typebox)
  - [Using Zod 4](#using-zod-4)
- [Auto-Generated Primary Keys](#auto-generated-primary-keys)
  - [Schema Configuration](#schema-configuration)
  - [Basic Usage](#basic-usage-1)
  - [Client-Provided Keys Configuration](#client-provided-keys-configuration)
  - [Backend-Specific Behavior](#backend-specific-behavior)
  - [Constraints](#constraints)
  - [Type Safety](#type-safety)
- [Implementations](#implementations)
  - [InMemoryTabularStorage](#inmemorytabularstorage)
  - [SqliteTabularStorage](#sqlitetabularstorage)
  - [PostgresTabularStorage](#postgrestabularstorage)
  - [IndexedDbTabularStorage](#indexeddbtabularstorage)
  - [FsFolderTabularStorage](#fsfoldertabularstorage)
- [Migrations](#migrations)
- [Events](#events)
- [Testing](#testing)
- [License](#license)

## Features

- Multiple storage backends:
  - In-memory (for testing/caching)
  - SQLite (embedded database)
  - PostgreSQL (relational database)
  - DuckDB (embedded analytical database)
  - IndexedDB (browser storage)
  - Filesystem (JSON file per record)
- Type-safe schema definitions
- Compound primary keys support
- Indexing for efficient search
- Event-driven architecture
- Cross-implementation test suite

## Installation

```bash
bun add @workglow/storage
# or
npm install @workglow/storage
```

## Basic Usage

```typescript
import { InMemoryTabularStorage } from "@workglow/storage/tabular";

// Define schema and primary keys
const schema = {
  id: "string",
  name: "string",
  age: "number",
  active: "boolean",
} as const;

const primaryKeys = ["id"] as const;
// Create repository instance (when using const schemas, the next three generics
// on InMemoryTabularStorage are automatically created for you)
const repo = new InMemoryTabularStorage<typeof schema, typeof primaryKeys>(schema, primaryKeys);

// Basic operations
await repo.put({ id: "1", name: "Alice", age: 30, active: true });
const result = await repo.get({ id: "1" });
await repo.delete({ id: "1" });
```

## Schema Definitions

You can define schemas using plain JSON Schema objects, or use schema libraries like TypeBox or Zod 4 to create them. All schemas must be compatible with `DataPortSchemaObject` from `@workglow/util`.

**Note:** When using TypeBox or Zod schemas, you **must** explicitly provide the generic type parameters to the repository constructor, as TypeScript cannot infer them from non-const schema definitions.

### Using TypeBox

TypeBox schemas are JSON Schema compatible and can be used directly:

```typescript
import { InMemoryTabularStorage } from "@workglow/storage/tabular";
import { Type, Static } from "@sinclair/typebox";
import { DataPortSchemaObject, FromSchema } from "@workglow/util";

// Define schema using TypeBox
const userSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: "email" }),
  age: Type.Optional(Type.Number({ minimum: 0, maximum: 150 })),
  active: Type.Boolean({ default: true }),
}) satisfies DataPortSchemaObject;

// Infer TypeScript types from schema
type User = FromSchema<typeof userSchema>;
// => { id: string; name: string; email: string; age?: number; active: boolean }

const primaryKeys = ["id"] as const;

type UserEntity = FromSchema<typeof userSchema>;

// IMPORTANT: You must explicitly provide generic type parameters for t
// TypeScript cannot infer them from TypeBox schemas
const repo = new InMemoryTabularStorage<typeof userSchema, typeof primaryKeys, UserEntity>(
  userSchema,
  primaryKeys,
  ["email", "active"] as const // Indexes
);

// Use with type safety
await repo.put({
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  active: true,
});
```

### Using Zod 4

Zod 4 has built-in JSON Schema support using the `.toJSONSchema()` method:

```typescript
import { InMemoryTabularStorage } from "@workglow/storage/tabular";
import { z } from "zod";
import { DataPortSchemaObject } from "@workglow/util";

// Define schema using Zod
const userSchemaZod = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
  active: z.boolean().default(true),
});

// Convert Zod schema to JSON Schema using built-in method
const userSchema = userSchemaZod.toJSONSchema() as DataPortSchemaObject;
const primaryKeys = ["id"] as const;

// Define computed types for the repository generics
type UserEntity = z.infer<typeof userSchemaZod>;

// IMPORTANT: You must explicitly provide generic type parameters
// TypeScript cannot infer them from Zod schemas (even after conversion)
const repo = new InMemoryTabularStorage<typeof userSchema, typeof primaryKeys, UserEntity>(
  userSchema,
  primaryKeys,
  ["email", "active"] as const // Indexes
);

// Use with type safety
await repo.put({
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  active: true,
});
```

## Auto-Generated Primary Keys

TabularStorage supports automatic generation of primary keys, allowing the storage backend to generate IDs when entities are inserted without them. This is useful for:

- Security: Preventing clients from choosing arbitrary IDs
- Simplicity: No need to generate IDs client-side
- Database features: Leveraging native auto-increment and UUID generation

### Schema Configuration

Mark a primary key column as auto-generated using the `x-auto-generated: true` annotation:

```typescript
const UserSchema = {
  type: "object",
  properties: {
    id: { type: "integer", "x-auto-generated": true }, // Auto-increment
    name: { type: "string" },
    email: { type: "string" },
  },
  required: ["id", "name", "email"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const DocumentSchema = {
  type: "object",
  properties: {
    id: { type: "string", "x-auto-generated": true }, // UUID
    title: { type: "string" },
    content: { type: "string" },
  },
  required: ["id", "title", "content"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
```

**Generation Strategy (inferred from column type):**

- `type: "integer"` → Auto-increment (SERIAL, INTEGER PRIMARY KEY, counter)
- `type: "string"` → UUID via `uuid4()` from `@workglow/util`

**Constraints:**

- Only the **first column** in a compound primary key can be auto-generated
- Only **one column** can be auto-generated per table

### Basic Usage

```typescript
import { InMemoryTabularStorage } from "@workglow/storage/tabular";

const userStorage = new InMemoryTabularStorage(UserSchema, ["id"] as const);
await userStorage.setupDatabase();

// Insert without providing ID - it will be auto-generated
const user = await userStorage.put({
  name: "Alice",
  email: "alice@example.com",
});
console.log(user.id); // 1 (auto-generated)

// TypeScript enforces: id is optional on insert, required on returned entity
```

### Client-Provided Keys Configuration

Control whether clients can provide values for auto-generated keys:

```typescript
const storage = new PostgresTabularStorage(
  db,
  "users",
  UserSchema,
  ["id"] as const,
  [], // indexes
  { clientProvidedKeys: "if-missing" } // configuration
);
```

**Options:**

| Setting                  | Behavior                                         | Use Case                                                          |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| `"if-missing"` (default) | Use client value if provided, generate otherwise | Flexible - supports both auto-generation and client-specified IDs |
| `"never"`                | Always generate, ignore client values            | Maximum security - never trust client IDs                         |
| `"always"`               | Require client to provide value                  | Testing/migration - enforce client-side ID generation             |

**Examples:**

```typescript
// Default: "if-missing" - flexible
const flexibleStorage = new InMemoryTabularStorage(UserSchema, ["id"] as const);

// Without ID - auto-generated
await flexibleStorage.put({ name: "Bob", email: "bob@example.com" });

// With ID - uses client value
await flexibleStorage.put({ id: 999, name: "Charlie", email: "charlie@example.com" });

// Secure mode: "never" - always generate
const secureStorage = new PostgresTabularStorage(db, "users", UserSchema, ["id"] as const, [], {
  clientProvidedKeys: "never",
});

// Even if client provides id, it will be ignored and regenerated
const result = await secureStorage.put({
  id: 999, // Ignored!
  name: "Diana",
  email: "diana@example.com",
});
// result.id will be database-generated, NOT 999

// Testing mode: "always" - require client ID
const testStorage = new InMemoryTabularStorage(UserSchema, ["id"] as const, [], {
  clientProvidedKeys: "always",
});

// Must provide ID or throws error
await testStorage.put({
  id: 1,
  name: "Eve",
  email: "eve@example.com",
}); // OK

await testStorage.put({
  name: "Frank",
  email: "frank@example.com",
}); // Throws Error!
```

### Backend-Specific Behavior

Each storage backend implements auto-generation differently:

| Backend                     | Integer (autoincrement)             | String (UUID)                     |
| --------------------------- | ----------------------------------- | --------------------------------- |
| **InMemoryTabularStorage**  | Internal counter (1, 2, 3...)       | `uuid4()` from `@workglow/util`   |
| **SqliteTabularStorage**    | `INTEGER PRIMARY KEY AUTOINCREMENT` | `uuid4()` client-side             |
| **PostgresTabularStorage**  | `SERIAL`/`BIGSERIAL`                | `gen_random_uuid()` database-side |
| **SupabaseTabularStorage**  | `SERIAL`                            | `gen_random_uuid()` database-side |
| **IndexedDbTabularStorage** | `autoIncrement: true`               | `uuid4()` client-side             |
| **FsFolderTabularStorage**  | Internal counter                    | `uuid4()` from `@workglow/util`   |

### Constraints

1. **Only first column**: Only the first primary key column can be auto-generated
2. **Single auto-gen key**: Only one column per table can be auto-generated
3. **Type inference**: Generation strategy is inferred from column type (integer → autoincrement, string → UUID)

### Type Safety

TypeScript enforces correct usage through the type system:

```typescript
// Auto-generated key is OPTIONAL on insert
const entity = { name: "Alice", email: "alice@example.com" };
await storage.put(entity); // ✅ OK - id can be omitted

// Returned entity has ALL fields REQUIRED
const result = await storage.put(entity);
const id: number = result.id; // ✅ OK - id is guaranteed to exist
```

## Implementations

### InMemoryTabularStorage

- Ideal for testing/development
- No persistence
- Fast search capabilities

```typescript
const repo = new InMemoryTabularStorage<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(schema, primaryKeys, ["name", "active"]);
```

### SqliteTabularStorage

- Embedded SQLite database
- File-based or in-memory

Call **`await Sqlite.init()`** once (from `@workglow/storage/sqlite` or `workglow`) before opening a database by **path** or constructing **`new Sqlite.Database(...)`**.

```typescript
import { SqliteTabularStorage } from "@workglow/storage";
import { Sqlite } from "@workglow/storage/sqlite";

await Sqlite.init();

const repo = new SqliteTabularStorage<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  ":memory:", // Database path
  "users", // Table name
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const // Indexes
);
```

### PostgresTabularStorage

- PostgreSQL backend
- Connection pooling support

```typescript
import type { Pool } from "@workglow/storage/postgres";

const pool = new Pool({/* config */});
const repo = new PostgresTabularStorage<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  pool, // postgres connection pool
  "users",
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const
);
```

### DuckDbTabularStorage

- Embedded DuckDB database (via `@workglow/duckdb/storage`)
- File-based or in-memory
- Postgres-flavored SQL under the hood

```typescript
import { DuckDbTabularStorage } from "@workglow/duckdb/storage";

const repo = new DuckDbTabularStorage<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  ":memory:", // Database path (or an open DuckDbDatabase)
  "users", // Table name
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const // Indexes
);
```

### IndexedDbTabularStorage

- Browser-based storage
- Automatic schema migration

```typescript
const repo = new IndexedDbTabularStorage<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  "user_db", // Database name
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const
);
```

### FsFolderTabularStorage

- Filesystem storage (one JSON file per record)
- Simple persistence format

```typescript
const repo = new FsFolderTabularStorage<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>("./data/users", schema, primaryKeys);
```

## Migrations

Tabular storages accept an optional `tabularMigrations` constructor parameter — a versioned, ordered list of declarative ops that evolve older deployments to the current target schema. Migrations work uniformly across all backends (SQL, IndexedDB, schemaless) and reuse the `_storage_migrations` bookkeeping table the rest of the migration system already uses.

```typescript
import { SqliteTabularStorage } from "@workglow/sqlite/storage";
import type { ITabularMigration } from "@workglow/storage";

const migrations: ITabularMigration[] = [
  {
    version: 1,
    description: "add archived flag",
    ops: [
      // Note: ALTER TABLE ADD COLUMN NOT NULL fails on populated tables in
      // SQL backends without a DEFAULT, so use a nullable schema.
      {
        kind: "addColumn",
        name: "archived",
        schema: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      },
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
    description: "lowercase emails",
    ops: [
      {
        kind: "backfill",
        batchSize: 500,
        transform: (row) => ({ ...row, email: (row.email as string).toLowerCase() }),
      },
    ],
  },
];

const repo = new SqliteTabularStorage(
  db,
  "users",
  schema,
  ["id"] as const,
  [],
  "if-missing",
  migrations
);
await repo.setupDatabase(); // applies pending migrations
```

**Op coverage:** `addColumn`, `dropColumn`, `renameColumn`, `addIndex`, `dropIndex`, `backfill`.

**Backend behavior:**

- **SQL backends** (SQLite, Postgres, Supabase): DDL ops translate to native `ALTER TABLE` / `CREATE INDEX`. Each migration runs inside a single `withTransaction` so DDL + backfill + bookkeeping commit atomically.
- **IndexedDB**: `addIndex` / `dropIndex` run inside an upgrade transaction. `backfill` runs on a normal readwrite transaction afterward (IDB upgrade transactions cannot span async work).
- **InMemory / SharedInMemory / FsFolder / HuggingFace**: DDL ops are no-ops (records are JS objects). `backfill` runs through the normal `getPage` / `put` / `delete` API. FsFolder persists bookkeeping to `_storage_migrations.json` beside the data; others hold it in process.

**Fresh-DB fast path:** when a storage is constructed at the target schema and the underlying table/store is empty, the orchestrator records every declared migration as already-applied without running its ops. This keeps backfills from running against zero rows on a fresh deployment.

**Adoption:**

- Existing storages without `tabularMigrations` continue unchanged — the migration system is fully opt-in.
- **Fresh-DB fast path:** when a storage is opened with declared migrations against a brand-new database (no prior bookkeeping AND no pre-existing table), every declared migration is recorded as already-applied without executing its ops. A fresh deployment therefore never runs `addColumn` against a table that was just created at the target schema.
- **Index ops are idempotent at the DDL level:** `addIndex` / `dropIndex` emit `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS` on SQL backends, and the IndexedDB applier guards `createIndex` / `deleteIndex` with `objectStore.indexNames.contains`. Retries after partial failures are safe.
- **Column ops are NOT idempotent at the DDL level:** `addColumn` / `dropColumn` / `renameColumn` emit plain `ALTER TABLE` statements. Re-running a successful migration is prevented by the bookkeeping table (`_storage_migrations` records the applied `(component, version)`), not by the DDL itself.

See `docs/superpowers/specs/2026-05-07-unified-tabular-migrations-design.md` for the full design and `docs/superpowers/plans/2026-05-07-unified-tabular-migrations.md` for implementation notes.

## Joins

`join(spec, right)` pairs rows of one storage (the left side) with rows of another. The
default is an application-side hash join built on `query` and the `in` criterion, and the
SQL backends (SQLite, PostgreSQL, DuckDB) run one `JOIN` statement when both storages share
a connection and dialect. Two backends cannot do either — see the last bullet below.

```typescript
const rows = await posts.join(
  {
    type: "left", // or "inner"
    on: [{ left: "author_id", right: "id" }], // several pairs make a compound key
    where: { left: { views: { value: 10, operator: ">" } }, right: { country: "US" } },
    orderBy: [{ side: "right", column: "name", direction: "ASC" }],
    limit: 20,
    offset: 0,
  },
  authors
);
// rows: Array<{ left: Post; right: Author | undefined }>
```

- Rows stay nested as `{ left, right }`, so same-named columns never collide. Under a
  `left` join an unmatched left row has `right: undefined`; under `inner` it is dropped.
- `where.right` is part of the join condition, not a filter over the result: a `left` join
  keeps its unmatched rows however the right side is filtered.
- A join key that is `null` on either side never matches, as in SQL.
- `orderBy` under `ASC` puts nulls (and unmatched right sides) first, under `DESC` last, on
  every backend.
- Returns `[]` when nothing matches, and emits no event of its own.
- Rows are not copies on the hash-join path — they are the objects `query`/`getAll`
  returned, matching those methods. The SQL path builds fresh objects. Do not mutate them.
- `join` is the one read on `CachedTabularStorage` that bypasses the cache: it reads the
  durable store on both sides, so it can return a row `query()` does not yet see.
- `ScopedTabularStorage` requires a scoped right side and refuses anything else, rather
  than joining unscoped across every `kb_id`.
- `FsFolderTabularStorage` and `HuggingFaceTabularStorage` throw `StorageUnsupportedError`,
  since neither can run the `in` query the hash join needs. Used as the RIGHT side they
  surface their own `query` error instead, since that is the call the hash join makes.

## Events

All implementations emit events:

- `put`: When a record is created/updated
- `get`: When a record is retrieved
- `delete`: When a record is deleted
- `clearall`: When all records are deleted
- `search`: When a search is performed

```typescript
repo.on("put", (entity) => {
  console.log("Record stored:", entity);
});

repo.on("delete", (key) => {
  console.log("Record deleted:", key);
});
```

## Testing

The implementations share a common test suite. To run tests:

```bash
bun test
```

Test includes:

- Basic CRUD operations
- Compound key handling
- Index-based search
- Event emission
- Concurrency tests

## License

Apache 2.0

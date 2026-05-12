# @workglow/postgres

Postgres backends for @workglow/storage and @workglow/job-queue.

## Features

- Postgres implementation of `@workglow/storage` interfaces
- Postgres implementation of `@workglow/job-queue` interfaces
- Postgres-native `ITextIndex` for `@workglow/knowledge-base` hybrid search
- Persistent storage for tasks, vectors, and queues

## Installation

```bash
npm install @workglow/postgres
# or
bun add @workglow/postgres
# or
yarn add @workglow/postgres
```

## Usage

```typescript
import { PostgresTabularStorage } from "@workglow/postgres/storage";
import { PostgresQueueStorage } from "@workglow/postgres/job-queue";

const storage = new PostgresTabularStorage(connectionConfig);
const queue = new PostgresQueueStorage(connectionConfig);
```

### Postgres-native hybrid search

`PostgresFtsTextIndex` is an `ITextIndex` backed by a single side table per
KB indexed by a GIN `tsvector` (Postgres FTS). Plug it into a
`KnowledgeBase` to get `kb.hybridSearch()` / `kb.textSearch()` with the
full-text postings living server-side rather than in the JS heap.

Benefits over the in-memory `BM25Index` default for Postgres-backed KBs:

- **Durable, server-side index**: postings live in Postgres as a side table
  with a GIN index; the index survives process restarts without a rebuild.
- **No in-memory BM25 state**: the JS heap doesn't hold the inverted index —
  the database does. Incremental `add` / `remove` writes don't grow heap.
- **Transactional rebuild**: `beginRebuild` / `commitRebuild` / `abortRebuild`
  wrap the rebuild in a single `BEGIN` / `COMMIT` / `ROLLBACK` so a mid-
  rebuild crash leaves the prior index intact.

> **Note**: `KnowledgeBase.reindexText()` still iterates all chunks via
> `chunkStorage.getAll()` to populate the index. The benefit here is not
> memory savings on reindex; it's that the *index itself* lives server-
> side and incremental writes don't grow the JS heap.

```typescript
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { PostgresFtsTextIndex } from "@workglow/postgres/text";

const textIndex = new PostgresFtsTextIndex(pool, "my_kb_fts");
// One-time DDL: CREATE TABLE + GIN index, idempotent.
await textIndex.setupDatabase();

const kb = await createKnowledgeBase({
  name: "my-kb",
  vectorDimensions: 768,
  textIndex,
});
```

> **Note**: the `table` argument is validated against a strict identifier
> whitelist — alphanumerics and underscore only, and must start with a
> letter or underscore (regex: `/^[A-Za-z_][A-Za-z0-9_]*$/`). Schema-
> qualified names (e.g. `public.chunks_fts`) and names containing dashes
> are rejected with an `Error` at DDL time. If you need to use a non-
> default schema, configure it via the Postgres pool's `search_path`
> instead.

`reindexText` wraps the rebuild in a Postgres transaction via the
`ITextIndex.beginRebuild` / `commitRebuild` / `abortRebuild` hooks, so a
failed rebuild rolls back atomically. `toJSON` / `fromJSON` are no-ops:
the table is the snapshot.

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.

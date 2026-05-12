---
"@workglow/storage": minor
"@workglow/knowledge-base": minor
"@workglow/postgres": minor
---

#### storage

- `ITextIndex.search` may now return `Promise<TextSearchResult[]>` in
  addition to the previous synchronous shape. External implementers
  should re-check their return types.
- Index-mutation methods (`add`, `remove`, `removeByDocument`, `clear`,
  `size`) on `ITextIndex` may now return a `Promise`. In-memory
  implementations (`BM25Index`) continue to return synchronously.
- New optional lifecycle hooks on `ITextIndex`: `beginRebuild`,
  `commitRebuild`, `abortRebuild`. Backends with server-side state can
  implement these so `KnowledgeBase.reindexText` wraps the rebuild in a
  real database transaction; in-memory backends can omit them.

#### knowledge-base

- `KnowledgeBase.reindexText` uses the new `ITextIndex.beginRebuild` /
  `commitRebuild` / `abortRebuild` hooks when the installed index
  implements them; falls back to the existing `toJSON` / `fromJSON`
  snapshot rollback otherwise.
- `textSearch` / `hybridSearch` `await` the text index's `search`
  return value so async backends are first-class.
- **Breaking-ish (external callers of `ScopedTabularStorage` only)**:
  the `ScopedTabularStorage` constructor now throws when the inner
  storage's primary key does not include `kb_id`. This formalizes a
  contract that was always required for correct kb-scoping on SQL
  backends, which build `get` / `getBulk` `WHERE` clauses from PK
  columns only and would otherwise silently drop the injected `kb_id`,
  leaking rows across knowledge bases. External consumers wrapping
  `Shared*` schemas from `@workglow/knowledge-base` are unaffected;
  those whose custom storages omit `kb_id` from the PK will fail loudly
  at construction rather than silently leaking rows. When the inner
  storage doesn't expose `primaryKeyNames`, the constructor warns
  instead of throwing.

#### postgres

- New `PostgresFtsTextIndex` (`@workglow/postgres/text`) restoring
  Postgres-native hybrid search. Backed by a single side table per KB
  indexed by a GIN `tsvector`; scoring via `ts_rank_cd` /
  `plainto_tsquery`. Plug it into a `KnowledgeBase` to get
  `kb.hybridSearch()` / `kb.textSearch()` with the full-text postings
  living server-side rather than in the JS heap. Benefits versus the
  in-memory `BM25Index` default: a durable server-side index that
  survives process restarts, no JS-heap BM25 state, and a transactional
  `beginRebuild` / `commitRebuild` / `abortRebuild` rebuild path.
  `reindexText()` itself still iterates all chunks via
  `chunkStorage.getAll()` to repopulate the index — the savings are
  on the steady-state JS heap, not on the rebuild pass.
  `setupDatabase()` is required before first use.

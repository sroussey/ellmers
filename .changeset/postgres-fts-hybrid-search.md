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

#### postgres

- New `PostgresFtsTextIndex` (`@workglow/postgres/text`) restoring
  Postgres-native hybrid search. Backed by a single side table per KB
  indexed by a GIN `tsvector`; scoring via `ts_rank_cd` / `plainto_tsquery`.
  Plug it into a `KnowledgeBase` to get `kb.hybridSearch()` /
  `kb.textSearch()` without loading every chunk into memory at reindex
  time. `setupDatabase()` is required before first use.

---
"@workglow/storage": minor
"@workglow/knowledge-base": minor
"@workglow/ai": patch
---

#### knowledge-base

- Add BM25F full-text search and RRF hybrid search at the KnowledgeBase
  layer. New `ITextIndex` interface and `BM25Index` implementation live in
  `@workglow/storage/text`; `KnowledgeBase` gains `installTextIndex`,
  `textSearch`, `hybridSearch`, `reindexText`, and a `textIndex?` factory
  option on `createKnowledgeBase`. Chunk upserts auto-write to the
  installed index; `deleteDocument` cascades.
- `ChunkSearchResult` gains an optional `scoreType: "cosine" | "bm25" |
  "rrf"` discriminator so callers can render scores on the appropriate
  scale.
- `ChunkRetrievalTask` output exposes a top-level `scoreType` field.

#### storage (breaking)

- Remove `IVectorStorage.hybridSearch` and the `HybridSearchOptions` type
  from `@workglow/storage`. Hybrid search now lives at the
  `KnowledgeBase` layer via `kb.hybridSearch()` after installing an
  `ITextIndex`. Callers that imported `HybridSearchOptions` from
  `@workglow/storage` should import it from `@workglow/knowledge-base`
  (the shape is different — it no longer carries `scoreThreshold`, since
  RRF scores are not comparable to cosine).
- All in-tree vector storage implementations (InMemory, IndexedDB,
  SQLite, sqlite-vector, Postgres) drop their naive textRelevance-based
  `hybridSearch` methods. External implementations of `IVectorStorage`
  must drop the method.

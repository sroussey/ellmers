# KB RunConfig Threading + New Tasks

**Date:** 2026-05-15  
**Packages affected:** `@workglow/knowledge-base`, `@workglow/ai`

## Problem

`KnowledgeBase.search()`, `.upsert()`, `.delete()`, and `.reindex()` call their installed `IKbAiStrategy`, which in turn spawns AI sub-tasks (`TextEmbeddingTask`, `HierarchicalChunkerTask`, `TextRerankerTask`, etc.) without any `runConfig`. This means:

- No `resourceScope` — model resources aren't registered for cleanup; every call may load the embedding model fresh.
- No `registry` — service registry isn't shared across the subtask tree.
- No `signal` — abort signals don't propagate into AI sub-tasks.

KB tasks (`KbSearchTask`, `KbReindexTask`) receive an `IExecuteContext` but currently ignore it for the KB call.

No task-level wrappers exist for adding or deleting a document, so callers either call the KB directly (losing runConfig) or wire up `ChunkVectorUpsertTask` manually (which is lower-level and doesn't drive the full strategy).

## Design

### 1. Package dependency

Add `@workglow/task-graph` as a peer dep (and dev dep) in `packages/knowledge-base/package.json`. The dep graph in CLAUDE.md already places `task-graph → dataset` (dataset may import from task-graph), so this is architecturally valid. All imports will be type-only.

### 2. `IKbAiStrategy` interface

Each method gains an optional trailing `runConfig` parameter. Optional keeps existing custom strategy implementations backward-compatible.

```ts
interface IKbAiStrategy {
  ingest(kb: IKbStrategyTarget, doc: Document,
         runConfig?: Partial<IRunConfig>): Promise<Document>;
  delete(kb: IKbStrategyTarget, doc_id: string,
         runConfig?: Partial<IRunConfig>): Promise<void>;
  search(kb: IKbStrategyTarget, query: string,
         options?: ISearchOptions,
         runConfig?: Partial<IRunConfig>): Promise<ChunkSearchResult[]>;
}
```

File: `packages/knowledge-base/src/knowledge-base/IKbAiStrategy.ts`

### 3. `KnowledgeBase` public API

Four methods grow an optional `runConfig` parameter. Each delegates straight to the strategy unchanged otherwise.

```ts
async upsert(doc: Document,    runConfig?: Partial<IRunConfig>): Promise<Document>
async delete(doc_id: string,   runConfig?: Partial<IRunConfig>): Promise<void>
async search(query: string,    options?: ISearchOptions, runConfig?: Partial<IRunConfig>): Promise<ChunkSearchResult[]>
async reindex(                 runConfig?: Partial<IRunConfig>): Promise<number>
```

File: `packages/knowledge-base/src/knowledge-base/KnowledgeBase.ts`

### 4. `createStandardKbStrategy`

The private `embedTexts` helper gains a `runConfig` param and passes it to `TextEmbeddingTask.run()`.

Threading points:
- `ingest`: `HierarchicalChunkerTask().run({...}, runConfig)` + `embedTexts([...], model, runConfig)`
- `search`: `embedTexts([query], model, runConfig)` + `TextRerankerTask().run({...}, runConfig)` + `RerankerTask().run({...}, runConfig)`
- `delete`: pure storage, no sub-tasks, no change needed.

File: `packages/ai/src/kb/createStandardKbStrategy.ts`

### 5. KB tasks

#### `KbSearchTask` (updated)

- Rename `_context` → `context`; pass `context.runConfig` to `kb.search(query, {topK, filter, scoreThreshold}, context.runConfig)`.
- Trim the what-explaining comment blocks inside `execute()` per project style (only non-obvious *why* survives).

File: `packages/ai/src/task/KbSearchTask.ts`

#### `KbReindexTask` (updated)

Thread `context.runConfig` to `kb.reindex(context.runConfig)`.

File: `packages/ai/src/task/KbReindexTask.ts`

#### `KbAddDocumentTask` (new)

```ts
// Input
{ knowledgeBase: KnowledgeBase, document: Document }

// Output
{ doc_id: string }

// Behaviour
cacheable = false
execute: const stored = await kb.upsert(input.document as Document, context.runConfig);
          return { doc_id: stored.doc_id! };
```

- Follows the same task/factory/Workflow-augmentation structure as `KbReindexTask`.
- Exports `kbAddDocument` standalone helper and `Workflow.prototype.kbAddDocument`.

File: `packages/ai/src/task/KbAddDocumentTask.ts`

#### `KbDeleteTask` (new)

```ts
// Input
{ knowledgeBase: KnowledgeBase, doc_id: string }

// Output
{ doc_id: string }   // echoes input — composable in pipelines

// Behaviour
cacheable = false
execute: await kb.delete(input.doc_id, context.runConfig);
          return { doc_id: input.doc_id };
```

- Exports `kbDelete` standalone helper and `Workflow.prototype.kbDelete`.

File: `packages/ai/src/task/KbDeleteTask.ts`

### 6. Exports

Both new task files must be:
- Imported and registered in `packages/ai/src/common.ts` (or the appropriate barrel file where other KB tasks are exported).
- Re-exported from the `@workglow/ai` package entry points (browser/node/bun).

### 7. `KbToDocumentsTask`

No change — it performs only storage reads, no AI sub-tasks, no runConfig needed.

## Non-goals

- No changes to `IKbStrategyTarget` (the strategy-facing KB surface).
- No changes to `ScopedKnowledgeBase` (virtual dispatch handles scoping transparently).
- No new runConfig threading for the low-level building-block methods (`upsertChunk`, `similaritySearch`, etc.) — those are pure storage ops.
- No removal of `ChunkRetrievalTask` or other existing tasks.

## Testing

- Existing KB strategy tests should pass unchanged (all new params are optional).
- Add unit tests for `KbAddDocumentTask` and `KbDeleteTask` mirroring `KbReindexTask`'s test pattern.
- Verify that `KbSearchTask` threads `runConfig.signal` by running a search with an already-aborted signal and confirming propagation.

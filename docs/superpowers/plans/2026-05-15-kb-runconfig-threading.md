# KB RunConfig Threading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread `IRunConfig` (signal, resourceScope, registry) through `KnowledgeBase.upsert/delete/search/reindex` and their `IKbAiStrategy` implementations, and add `KbAddDocumentTask` + `KbDeleteTask`.

**Architecture:** Add `@workglow/task-graph` as a peer dep to `@workglow/knowledge-base`; the dep graph in CLAUDE.md already places `task-graph → dataset`, so this is valid. `IKbAiStrategy` methods gain an optional `runConfig?: Partial<IRunConfig>` trailing param (backward-compatible). KB tasks extract `{signal, resourceScope, registry}` from `IExecuteContext` and pass them to the KB call. New tasks `KbAddDocumentTask` and `KbDeleteTask` follow the same pattern as `KbReindexTask`.

**Tech Stack:** TypeScript, Bun workspaces, Vitest

---

## File Map

**Modified:**
- `packages/knowledge-base/package.json` — add `@workglow/task-graph` peer + dev dep
- `packages/knowledge-base/src/knowledge-base/IKbAiStrategy.ts` — add `runConfig?` to interface methods
- `packages/knowledge-base/src/knowledge-base/KnowledgeBase.ts` — add `runConfig?` to `upsert`, `delete`, `search`, `reindex`
- `packages/ai/src/kb/createStandardKbStrategy.ts` — thread `runConfig` through `embedTexts`, `ingest`, `search`
- `packages/ai/src/task/KbSearchTask.ts` — use `context` (not `_context`), pass run context to `kb.search`, trim what-explaining comments
- `packages/ai/src/task/KbReindexTask.ts` — use `context`, pass run context to `kb.reindex`
- `packages/ai/src/task/index.ts` — export two new tasks
- `packages/ai/src/task/registerAiTasks.ts` — register two new tasks
- `packages/test/src/test/rag/KbSearchTask.test.ts` — add runConfig threading test

**Created:**
- `packages/ai/src/task/KbAddDocumentTask.ts`
- `packages/ai/src/task/KbDeleteTask.ts`
- `packages/test/src/test/rag/KbAddDocumentTask.test.ts`
- `packages/test/src/test/rag/KbDeleteTask.test.ts`

---

## Task 1: Add `@workglow/task-graph` peer dep to `@workglow/knowledge-base`

**Files:**
- Modify: `packages/knowledge-base/package.json`

- [ ] **Step 1: Add task-graph to peerDependencies, peerDependenciesMeta, and devDependencies**

In `packages/knowledge-base/package.json`, make these three targeted edits:

Replace:
```json
  "peerDependencies": {
    "@workglow/storage": "workspace:*",
    "@workglow/util": "workspace:*"
  },
```
With:
```json
  "peerDependencies": {
    "@workglow/storage": "workspace:*",
    "@workglow/task-graph": "workspace:*",
    "@workglow/util": "workspace:*"
  },
```

Replace:
```json
  "peerDependenciesMeta": {
    "@workglow/storage": {
      "optional": false
    },
    "@workglow/util": {
      "optional": false
    }
  },
```
With:
```json
  "peerDependenciesMeta": {
    "@workglow/storage": {
      "optional": false
    },
    "@workglow/task-graph": {
      "optional": false
    },
    "@workglow/util": {
      "optional": false
    }
  },
```

Replace:
```json
  "devDependencies": {
    "@workglow/storage": "workspace:*",
    "@workglow/util": "workspace:*"
  },
```
With:
```json
  "devDependencies": {
    "@workglow/storage": "workspace:*",
    "@workglow/task-graph": "workspace:*",
    "@workglow/util": "workspace:*"
  },
```

- [ ] **Step 2: Verify bun install still resolves**

```bash
bun install
```
Expected: No errors. The workspace symlink for `@workglow/task-graph` should appear in `node_modules`.

- [ ] **Step 3: Commit**

```bash
git add packages/knowledge-base/package.json
git commit -m "feat: add task-graph peer dep to knowledge-base"
```

---

## Task 2: Add `runConfig` to `IKbAiStrategy` interface

**Files:**
- Modify: `packages/knowledge-base/src/knowledge-base/IKbAiStrategy.ts`

- [ ] **Step 1: Write the failing build check**

The build will fail on Task 3 when KnowledgeBase.ts tries to import IRunConfig (if this task is skipped). Confirm now that there's no existing import of `task-graph` in this file:

```bash
grep -n "task-graph" packages/knowledge-base/src/knowledge-base/IKbAiStrategy.ts
```
Expected: no output.

- [ ] **Step 2: Add the import**

At the top of `packages/knowledge-base/src/knowledge-base/IKbAiStrategy.ts`, after the license header, add the import for `IRunConfig`. The file currently begins its imports with:
```ts
import type { TypedArray } from "@workglow/util/schema";
```

Insert before that line:
```ts
import type { IRunConfig } from "@workglow/task-graph";
```

- [ ] **Step 3: Update `ingest` signature**

Find:
```ts
  ingest(kb: IKbStrategyTarget, doc: Document): Promise<Document>;
```
Replace with:
```ts
  ingest(kb: IKbStrategyTarget, doc: Document, runConfig?: Partial<IRunConfig>): Promise<Document>;
```

- [ ] **Step 4: Update `delete` signature**

Find:
```ts
  delete(kb: IKbStrategyTarget, doc_id: string): Promise<void>;
```
Replace with:
```ts
  delete(kb: IKbStrategyTarget, doc_id: string, runConfig?: Partial<IRunConfig>): Promise<void>;
```

- [ ] **Step 5: Update `search` signature**

Find:
```ts
  search(
    kb: IKbStrategyTarget,
    query: string,
    options?: ISearchOptions
  ): Promise<ChunkSearchResult[]>;
```
Replace with:
```ts
  search(
    kb: IKbStrategyTarget,
    query: string,
    options?: ISearchOptions,
    runConfig?: Partial<IRunConfig>
  ): Promise<ChunkSearchResult[]>;
```

- [ ] **Step 6: Verify type-check compiles**

```bash
cd packages/knowledge-base && bun run build-types 2>&1 | tail -5
```
Expected: no errors (existing strategy implementations tolerate the new optional param).

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-base/src/knowledge-base/IKbAiStrategy.ts
git commit -m "feat: add optional runConfig to IKbAiStrategy methods"
```

---

## Task 3: Thread `runConfig` through `KnowledgeBase` public API

**Files:**
- Modify: `packages/knowledge-base/src/knowledge-base/KnowledgeBase.ts`

- [ ] **Step 1: Add the import**

`KnowledgeBase.ts` currently imports from `"./IKbAiStrategy"`. Add `IRunConfig` import after the license header — before any other imports (or alongside related type imports). Find the first import block and add:
```ts
import type { IRunConfig } from "@workglow/task-graph";
```

- [ ] **Step 2: Update `upsert`**

Find:
```ts
  async upsert(doc: Document): Promise<Document> {
    const strategy = this.requireStrategy("upsert");
    return strategy.ingest(this, doc);
  }
```
Replace with:
```ts
  async upsert(doc: Document, runConfig?: Partial<IRunConfig>): Promise<Document> {
    const strategy = this.requireStrategy("upsert");
    return strategy.ingest(this, doc, runConfig);
  }
```

- [ ] **Step 3: Update `delete`**

Find:
```ts
  async delete(doc_id: string): Promise<void> {
    const strategy = this.requireStrategy("delete");
    return strategy.delete(this, doc_id);
  }
```
Replace with:
```ts
  async delete(doc_id: string, runConfig?: Partial<IRunConfig>): Promise<void> {
    const strategy = this.requireStrategy("delete");
    return strategy.delete(this, doc_id, runConfig);
  }
```

- [ ] **Step 4: Update `search`**

Find:
```ts
  async search(query: string, options?: ISearchOptions): Promise<ChunkSearchResult[]> {
    const strategy = this.requireStrategy("search");
    return strategy.search(this, query, options);
  }
```
Replace with:
```ts
  async search(query: string, options?: ISearchOptions, runConfig?: Partial<IRunConfig>): Promise<ChunkSearchResult[]> {
    const strategy = this.requireStrategy("search");
    return strategy.search(this, query, options, runConfig);
  }
```

- [ ] **Step 5: Update `reindex`**

Find:
```ts
  async reindex(): Promise<number> {
    const strategy = this.requireStrategy("reindex");
    const docIds = await this.listDocuments();
    let count = 0;
    for (const doc_id of docIds) {
      const doc = await this.getDocument(doc_id);
      if (!doc) continue;
      await strategy.ingest(this, doc);
      count++;
    }
    return count;
  }
```
Replace with:
```ts
  async reindex(runConfig?: Partial<IRunConfig>): Promise<number> {
    const strategy = this.requireStrategy("reindex");
    const docIds = await this.listDocuments();
    let count = 0;
    for (const doc_id of docIds) {
      const doc = await this.getDocument(doc_id);
      if (!doc) continue;
      await strategy.ingest(this, doc, runConfig);
      count++;
    }
    return count;
  }
```

- [ ] **Step 6: Verify type-check**

```bash
cd packages/knowledge-base && bun run build-types 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-base/src/knowledge-base/KnowledgeBase.ts
git commit -m "feat: add optional runConfig param to KnowledgeBase upsert/delete/search/reindex"
```

---

## Task 4: Thread `runConfig` through `createStandardKbStrategy`

**Files:**
- Modify: `packages/ai/src/kb/createStandardKbStrategy.ts`

- [ ] **Step 1: Write a failing test first**

Run the existing strategy tests to confirm they pass before any changes:
```bash
bun scripts/test.ts rag vitest 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 2: Add the `IRunConfig` import**

In `packages/ai/src/kb/createStandardKbStrategy.ts`, the imports currently end with:
```ts
import { TextRerankerTask } from "../task/TextRerankerTask";
```

Add before that block:
```ts
import type { IRunConfig } from "@workglow/task-graph";
```

- [ ] **Step 3: Update `embedTexts` to accept and thread `runConfig`**

Find:
```ts
  const embedTexts = async (texts: readonly string[], modelId: string): Promise<TypedArray[]> => {
    if (texts.length === 0) return [];
    const result = await new TextEmbeddingTask().run({ text: texts as string[], model: modelId });
    const vector = result.vector;
    return Array.isArray(vector) ? (vector as TypedArray[]) : [vector as TypedArray];
  };
```
Replace with:
```ts
  const embedTexts = async (
    texts: readonly string[],
    modelId: string,
    runConfig?: Partial<IRunConfig>
  ): Promise<TypedArray[]> => {
    if (texts.length === 0) return [];
    const result = await new TextEmbeddingTask().run(
      { text: texts as string[], model: modelId },
      runConfig
    );
    const vector = result.vector;
    return Array.isArray(vector) ? (vector as TypedArray[]) : [vector as TypedArray];
  };
```

- [ ] **Step 4: Update `ingest` to accept and thread `runConfig`**

Find:
```ts
    async ingest(kb, doc): Promise<Document> {
```
Replace with:
```ts
    async ingest(kb, doc, runConfig): Promise<Document> {
```

Then within `ingest`, find the chunker run call:
```ts
      const chunkResult = await chunker.run({
        doc_id: docId,
        documentTree: stored.root as never,
        strategy: resolveChunkStrategy(kb),
        ...chunkerDefaults,
      });
```
Replace with:
```ts
      const chunkResult = await chunker.run(
        {
          doc_id: docId,
          documentTree: stored.root as never,
          strategy: resolveChunkStrategy(kb),
          ...chunkerDefaults,
        },
        runConfig
      );
```

Then find the `embedTexts` call inside `ingest`:
```ts
      const vectors = await embedTexts(
        chunks.map((c) => c.text),
        requireDocEmbedModel(kb)
      );
```
Replace with:
```ts
      const vectors = await embedTexts(
        chunks.map((c) => c.text),
        requireDocEmbedModel(kb),
        runConfig
      );
```

- [ ] **Step 5: Update `search` to accept and thread `runConfig`**

Find:
```ts
    async search(kb, query, options?: ISearchOptions): Promise<ChunkSearchResult[]> {
```
Replace with:
```ts
    async search(kb, query, options?: ISearchOptions, runConfig?: Partial<IRunConfig>): Promise<ChunkSearchResult[]> {
```

Within `search`, find the `embedTexts` call (it appears once for similarity/hybrid/rerank):
```ts
      const queryVec = await embedTexts([query], requireQueryEmbedModel(kb));
```
Replace with:
```ts
      const queryVec = await embedTexts([query], requireQueryEmbedModel(kb), runConfig);
```

Find the `TextRerankerTask` run call in the rerank branch:
```ts
        const result = await new TextRerankerTask().run({
          query,
          documents: docs,
          model: kb.rerankerModel,
          topK,
        });
```
Replace with:
```ts
        const result = await new TextRerankerTask().run(
          {
            query,
            documents: docs,
            model: kb.rerankerModel,
            topK,
          },
          runConfig
        );
```

Find the heuristic `RerankerTask` run call:
```ts
      const heuristic = await new RerankerTask().run({
        query,
        chunks: docs,
        scores: firstStage.map((c) => c.score),
        metadata: firstStage.map((c) => c.metadata as Record<string, unknown>),
        topK,
        method: "simple",
      });
```
Replace with:
```ts
      const heuristic = await new RerankerTask().run(
        {
          query,
          chunks: docs,
          scores: firstStage.map((c) => c.score),
          metadata: firstStage.map((c) => c.metadata as Record<string, unknown>),
          topK,
          method: "simple",
        },
        runConfig
      );
```

- [ ] **Step 6: Verify tests still pass**

```bash
bun scripts/test.ts rag vitest 2>&1 | tail -20
```
Expected: all pass (runConfig is optional, so existing call sites without it are unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/kb/createStandardKbStrategy.ts
git commit -m "feat: thread runConfig through createStandardKbStrategy sub-task calls"
```

---

## Task 5: Update `KbSearchTask` — thread context, trim comments

**Files:**
- Modify: `packages/ai/src/task/KbSearchTask.ts`
- Modify: `packages/test/src/test/rag/KbSearchTask.test.ts`

- [ ] **Step 1: Write the new failing test**

Add to `packages/test/src/test/rag/KbSearchTask.test.ts`, inside the `describe` block, after the existing two tests:

```ts
  it("threads run context (signal) to kb.search", async () => {
    const { kb, searchSpy } = await makeKbWithSearchSpy();

    await kbSearch({ knowledgeBase: kb, query: "hello" });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const call = searchSpy.mock.calls[0];
    // Third argument is the runConfig extracted from IExecuteContext.
    const forwardedRunConfig = call[2];
    expect(forwardedRunConfig).toBeDefined();
    expect(forwardedRunConfig).toMatchObject({ signal: expect.any(AbortSignal) });
  });
```

- [ ] **Step 2: Run the new test to confirm it currently fails**

```bash
bun scripts/test.ts rag vitest 2>&1 | grep -A 5 "threads run context"
```
Expected: FAIL — `forwardedRunConfig` is `undefined` because the current implementation doesn't pass it.

- [ ] **Step 3: Update `KbSearchTask.execute`**

In `packages/ai/src/task/KbSearchTask.ts`, replace the entire `execute` method:

```ts
  override async execute(
    input: KbSearchTaskInput,
    _context: IExecuteContext
  ): Promise<KbSearchTaskOutput> {
    const { knowledgeBase, query, topK = 5, filter, scoreThreshold } = input;
    const kb = knowledgeBase as KnowledgeBase;
    // Forward `scoreThreshold` to the strategy. The standard strategy
    // honors it in similarity / hybrid modes and intentionally ignores
    // it in rerank mode (cross-encoder logits aren't on the same scale
    // as cosine / RRF, so a single numeric threshold would either drop
    // everything or nothing).
    const results = await kb.search(query, { topK, filter, scoreThreshold });
    return {
      results,
      // `chunkText` enforces the metadata.text contract — any chunk
      // missing text throws with its chunk_id rather than silently
      // emitting `JSON.stringify(metadata)` (which would surface as
      // garbage to downstream consumers).
      chunks: results.map(chunkText),
      chunk_ids: results.map((r) => r.chunk_id),
      scores: results.map((r) => r.score),
      count: results.length,
    };
  }
```

With:

```ts
  override async execute(
    input: KbSearchTaskInput,
    context: IExecuteContext
  ): Promise<KbSearchTaskOutput> {
    const { knowledgeBase, query, topK = 5, filter, scoreThreshold } = input;
    const kb = knowledgeBase as KnowledgeBase;
    const results = await kb.search(query, { topK, filter, scoreThreshold }, {
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return {
      results,
      chunks: results.map(chunkText),
      chunk_ids: results.map((r) => r.chunk_id),
      scores: results.map((r) => r.score),
      count: results.length,
    };
  }
```

- [ ] **Step 4: Run all three tests**

```bash
bun scripts/test.ts rag vitest 2>&1 | grep -E "PASS|FAIL|KbSearch"
```
Expected: all three `KbSearchTask` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/task/KbSearchTask.ts packages/test/src/test/rag/KbSearchTask.test.ts
git commit -m "feat: thread IExecuteContext through KbSearchTask to kb.search"
```

---

## Task 6: Update `KbReindexTask` — thread context

**Files:**
- Modify: `packages/ai/src/task/KbReindexTask.ts`

- [ ] **Step 1: Update the `execute` method**

In `packages/ai/src/task/KbReindexTask.ts`, replace:

```ts
  override async execute(
    input: KbReindexTaskInput,
    _context: IExecuteContext
  ): Promise<KbReindexTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    const count = await kb.reindex();
    return { count };
  }
```

With:

```ts
  override async execute(
    input: KbReindexTaskInput,
    context: IExecuteContext
  ): Promise<KbReindexTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    const count = await kb.reindex({
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return { count };
  }
```

- [ ] **Step 2: Verify tests still pass**

```bash
bun scripts/test.ts rag vitest 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/task/KbReindexTask.ts
git commit -m "feat: thread IExecuteContext through KbReindexTask to kb.reindex"
```

---

## Task 7: Create `KbAddDocumentTask`

**Files:**
- Create: `packages/ai/src/task/KbAddDocumentTask.ts`
- Create: `packages/test/src/test/rag/KbAddDocumentTask.test.ts`

- [ ] **Step 1: Write the tests first**

Create `packages/test/src/test/rag/KbAddDocumentTask.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { kbAddDocument } from "@workglow/ai";
import { Document, createKnowledgeBase } from "@workglow/knowledge-base";
import { uuid4 } from "@workglow/util";
import { describe, expect, it, vi } from "vitest";

describe("KbAddDocumentTask", () => {
  function makeDoc(docId?: string): Document {
    const doc = new Document(
      { type: "root", title: "T", children: [] } as never,
      { title: "Test" }
    );
    if (docId) doc.setDocId(docId);
    return doc;
  }

  async function makeKbWithUpsertSpy() {
    const kb = await createKnowledgeBase({
      name: `kb-add-doc-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
    const doc = makeDoc("returned-id");
    const upsertSpy = vi.spyOn(kb, "upsert").mockResolvedValue(doc);
    return { kb, doc, upsertSpy };
  }

  it("calls kb.upsert with the provided document", async () => {
    const { kb, doc, upsertSpy } = await makeKbWithUpsertSpy();

    await kbAddDocument({ knowledgeBase: kb, document: doc });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toBe(doc);
  });

  it("returns the doc_id from the upserted document", async () => {
    const { kb, doc } = await makeKbWithUpsertSpy();

    const result = await kbAddDocument({ knowledgeBase: kb, document: doc });

    expect(result.doc_id).toBe("returned-id");
  });

  it("threads run context (signal) to kb.upsert", async () => {
    const { kb, upsertSpy } = await makeKbWithUpsertSpy();

    await kbAddDocument({ knowledgeBase: kb, document: makeDoc("x") });

    const forwardedRunConfig = upsertSpy.mock.calls[0][1];
    expect(forwardedRunConfig).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
bun scripts/test.ts rag vitest 2>&1 | grep -A 3 "KbAddDocumentTask"
```
Expected: FAIL — `kbAddDocument` does not exist yet.

- [ ] **Step 3: Create the task file**

Create `packages/ai/src/task/KbAddDocumentTask.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KnowledgeBase } from "@workglow/knowledge-base";
import { Document, TypeKnowledgeBase } from "@workglow/knowledge-base";
import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "Knowledge base to add the document to.",
    }),
    document: {
      title: "Document",
      description: "The Document instance to chunk, embed, and store.",
      additionalProperties: true,
    },
  },
  required: ["knowledgeBase", "document"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The stored document ID.",
    },
  },
  required: ["doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbAddDocumentTaskInput = Omit<FromSchema<typeof inputSchema>, "document"> & {
  readonly document: Document;
};
export type KbAddDocumentTaskOutput = FromSchema<typeof outputSchema>;
export type KbAddDocumentTaskConfig = TaskConfig<KbAddDocumentTaskInput>;

/**
 * Ingest a document into a knowledge base end-to-end: chunk, embed, and
 * store via the KB's installed strategy. Threads the task's execution
 * context (signal, resourceScope, registry) into the KB call so model
 * resources are shared and abort signals propagate.
 */
export class KbAddDocumentTask extends Task<
  KbAddDocumentTaskInput,
  KbAddDocumentTaskOutput,
  KbAddDocumentTaskConfig
> {
  public static override type = "KbAddDocumentTask";
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "KB Add Document";
  public static override description =
    "Ingest a document into a knowledge base: chunk, embed, and store via the KB's installed strategy.";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbAddDocumentTaskInput,
    context: IExecuteContext
  ): Promise<KbAddDocumentTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    const stored = await kb.upsert(input.document as Document, {
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return { doc_id: stored.doc_id! };
  }
}

export const kbAddDocument = (
  input: KbAddDocumentTaskInput,
  config?: KbAddDocumentTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbAddDocumentTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbAddDocument: CreateWorkflow<
      KbAddDocumentTaskInput,
      KbAddDocumentTaskOutput,
      KbAddDocumentTaskConfig
    >;
  }
}

Workflow.prototype.kbAddDocument = CreateWorkflow(KbAddDocumentTask);
```

- [ ] **Step 4: Run tests (they will still fail — not exported yet)**

Registration happens in Task 9. For now, confirm the file compiles:

```bash
cd packages/ai && bun run build-types 2>&1 | tail -5
```
Expected: no errors from the new file itself (TypeScript can see it even before it's re-exported).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/task/KbAddDocumentTask.ts packages/test/src/test/rag/KbAddDocumentTask.test.ts
git commit -m "feat: add KbAddDocumentTask"
```

---

## Task 8: Create `KbDeleteTask`

**Files:**
- Create: `packages/ai/src/task/KbDeleteTask.ts`
- Create: `packages/test/src/test/rag/KbDeleteTask.test.ts`

- [ ] **Step 1: Write the tests first**

Create `packages/test/src/test/rag/KbDeleteTask.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { kbDelete } from "@workglow/ai";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { uuid4 } from "@workglow/util";
import { describe, expect, it, vi } from "vitest";

describe("KbDeleteTask", () => {
  async function makeKbWithDeleteSpy() {
    const kb = await createKnowledgeBase({
      name: `kb-delete-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
    const deleteSpy = vi.spyOn(kb, "delete").mockResolvedValue(undefined);
    return { kb, deleteSpy };
  }

  it("calls kb.delete with the given doc_id", async () => {
    const { kb, deleteSpy } = await makeKbWithDeleteSpy();

    await kbDelete({ knowledgeBase: kb, doc_id: "my-doc" });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toBe("my-doc");
  });

  it("echoes doc_id in the output", async () => {
    const { kb } = await makeKbWithDeleteSpy();

    const result = await kbDelete({ knowledgeBase: kb, doc_id: "my-doc" });

    expect(result.doc_id).toBe("my-doc");
  });

  it("threads run context (signal) to kb.delete", async () => {
    const { kb, deleteSpy } = await makeKbWithDeleteSpy();

    await kbDelete({ knowledgeBase: kb, doc_id: "my-doc" });

    const forwardedRunConfig = deleteSpy.mock.calls[0][1];
    expect(forwardedRunConfig).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun scripts/test.ts rag vitest 2>&1 | grep -A 3 "KbDeleteTask"
```
Expected: FAIL — `kbDelete` does not exist yet.

- [ ] **Step 3: Create the task file**

Create `packages/ai/src/task/KbDeleteTask.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KnowledgeBase } from "@workglow/knowledge-base";
import { TypeKnowledgeBase } from "@workglow/knowledge-base";
import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "Knowledge base to delete the document from.",
    }),
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "ID of the document to delete.",
    },
  },
  required: ["knowledgeBase", "doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "ID of the deleted document (echoed for pipeline composability).",
    },
  },
  required: ["doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type KbDeleteTaskInput = FromSchema<typeof inputSchema>;
export type KbDeleteTaskOutput = FromSchema<typeof outputSchema>;
export type KbDeleteTaskConfig = TaskConfig<KbDeleteTaskInput>;

/**
 * Delete a document and its chunks from a knowledge base via the KB's
 * installed strategy. Echoes `doc_id` so the task is composable in
 * pipelines that need to pass the id to a downstream step.
 */
export class KbDeleteTask extends Task<KbDeleteTaskInput, KbDeleteTaskOutput, KbDeleteTaskConfig> {
  public static override type = "KbDeleteTask";
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "KB Delete Document";
  public static override description =
    "Delete a document and its chunks from a knowledge base.";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: KbDeleteTaskInput,
    context: IExecuteContext
  ): Promise<KbDeleteTaskOutput> {
    const kb = input.knowledgeBase as KnowledgeBase;
    await kb.delete(input.doc_id, {
      signal: context.signal,
      resourceScope: context.resourceScope,
      registry: context.registry,
    });
    return { doc_id: input.doc_id };
  }
}

export const kbDelete = (
  input: KbDeleteTaskInput,
  config?: KbDeleteTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new KbDeleteTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    kbDelete: CreateWorkflow<KbDeleteTaskInput, KbDeleteTaskOutput, KbDeleteTaskConfig>;
  }
}

Workflow.prototype.kbDelete = CreateWorkflow(KbDeleteTask);
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd packages/ai && bun run build-types 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/task/KbDeleteTask.ts packages/test/src/test/rag/KbDeleteTask.test.ts
git commit -m "feat: add KbDeleteTask"
```

---

## Task 9: Register and export new tasks

**Files:**
- Modify: `packages/ai/src/task/index.ts`
- Modify: `packages/ai/src/task/registerAiTasks.ts`

- [ ] **Step 1: Export new tasks from `index.ts`**

In `packages/ai/src/task/index.ts`, find the KB task export block:
```ts
export * from "./KbReindexTask";
export * from "./KbSearchTask";
export * from "./KbToDocumentsTask";
```

Replace with:
```ts
export * from "./KbAddDocumentTask";
export * from "./KbDeleteTask";
export * from "./KbReindexTask";
export * from "./KbSearchTask";
export * from "./KbToDocumentsTask";
```

- [ ] **Step 2: Register new tasks in `registerAiTasks.ts`**

In `packages/ai/src/task/registerAiTasks.ts`, find the existing KB imports:
```ts
import { KbReindexTask } from "./KbReindexTask";
import { KbSearchTask } from "./KbSearchTask";
import { KbToDocumentsTask } from "./KbToDocumentsTask";
```

Replace with:
```ts
import { KbAddDocumentTask } from "./KbAddDocumentTask";
import { KbDeleteTask } from "./KbDeleteTask";
import { KbReindexTask } from "./KbReindexTask";
import { KbSearchTask } from "./KbSearchTask";
import { KbToDocumentsTask } from "./KbToDocumentsTask";
```

Then in the `tasks` array, find the block:
```ts
    KbSearchTask,
    KbToDocumentsTask,
```

Replace with:
```ts
    KbAddDocumentTask,
    KbDeleteTask,
    KbSearchTask,
    KbToDocumentsTask,
```

- [ ] **Step 3: Run all rag tests**

```bash
bun scripts/test.ts rag vitest 2>&1 | tail -30
```
Expected: all tests pass, including the new `KbAddDocumentTask` and `KbDeleteTask` suites.

- [ ] **Step 4: Run full build to catch any type errors**

```bash
bun run build:packages 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/task/index.ts packages/ai/src/task/registerAiTasks.ts
git commit -m "feat: register and export KbAddDocumentTask and KbDeleteTask"
```

---

## Task 10: Final verification and push

- [ ] **Step 1: Run the full rag test suite**

```bash
bun scripts/test.ts rag vitest 2>&1 | tail -30
```
Expected: all tests green.

- [ ] **Step 2: Run full build**

```bash
bun run build:packages 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 3: Push to feature branch**

```bash
git push -u origin claude/thread-resource-scope-U8rTa
```
Expected: push succeeds.

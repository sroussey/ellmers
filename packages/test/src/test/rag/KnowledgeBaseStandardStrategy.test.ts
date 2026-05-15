/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelRecord, TextEmbeddingTaskInput } from "@workglow/ai";
import {
  createStandardKbStrategy,
  getAiProviderRegistry,
  getGlobalModelRepository,
} from "@workglow/ai";
import type {
  ChunkVectorStorage,
  DocumentTabularStorage,
  InsertChunkVectorEntity,
} from "@workglow/knowledge-base";
import {
  ChunkVectorPrimaryKey,
  ChunkVectorStorageSchema,
  Document,
  DocumentStorageKey,
  DocumentStorageSchema,
  KnowledgeBase,
  StructuralParser,
  createKnowledgeBase,
} from "@workglow/knowledge-base";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Tests exercising `createStandardKbStrategy` directly. Setup registers a
 * tiny stub provider for `TextEmbeddingTask` so we don't need a real
 * runtime (HuggingFace etc.) to assert order/tagging contracts.
 */
const TEST_PROVIDER = "test-strategy-provider";
const TEST_EMBED_MODEL_ID = "test:strategy:embed";

describe("createStandardKbStrategy", () => {
  beforeAll(async () => {
    const registry = getAiProviderRegistry();
    const runFn: AiProviderRunFn = async (input, _model, _signal, emit) => {
      // Deterministic 3-D unit vector keyed off the first text character;
      // we don't need vector meaning here, only that embedTexts resolves.
      const embeddingInput = input as TextEmbeddingTaskInput;
      const texts = Array.isArray(embeddingInput.text)
        ? embeddingInput.text
        : [embeddingInput.text ?? ""];
      const vectors = texts.map(() => new Float32Array([1, 0, 0]));
      emit({
        type: "finish",
        data: {
          vector: vectors.length === 1 ? vectors[0] : vectors,
        },
      });
    };
    registry.registerRunFn(TEST_PROVIDER, {
      serves: ["text.embedding"],
      runFn,
    });

    const modelRepo = getGlobalModelRepository();
    const existing = await modelRepo.findByName(TEST_EMBED_MODEL_ID).catch(() => undefined);
    if (!existing) {
      await modelRepo.addModel({
        model_id: TEST_EMBED_MODEL_ID,
        capabilities: ["text.embedding"],
        title: "Strategy test embed model",
        description: "Stub embed model used by createStandardKbStrategy tests",
        provider: TEST_PROVIDER,
        provider_config: { native_dimensions: 3 },
        metadata: {},
      } as ModelRecord);
    }
  });

  /**
   * Seed the KB with a single pre-existing chunk so a re-ingest has
   * something to delete and the partial-failure test can verify it's gone.
   */
  async function seedChunk(kb: KnowledgeBase, doc_id: string, chunk_id: string): Promise<void> {
    const insert: InsertChunkVectorEntity = {
      chunk_id,
      doc_id,
      vector: new Float32Array([1, 0, 0]),
      metadata: {
        chunk_id,
        doc_id,
        text: "old chunk text",
        nodePath: [],
        depth: 0,
      } as never,
    };
    await kb.upsertChunksBulk([insert]);
  }

  it("ingest deletes existing chunks BEFORE upsertDocument when doc_id is set; partial failure leaves no orphan chunks", async () => {
    // KB subclass that rejects on upsertChunksBulk to simulate a failure
    // partway through ingest (after delete, after document upsert, after
    // chunker, after embed, but during the bulk insert).
    class FailingKb extends KnowledgeBase {
      failOnBulkInsert = false;
      override async upsertChunksBulk(chunks: InsertChunkVectorEntity[]) {
        if (this.failOnBulkInsert) {
          throw new Error("simulated bulk-insert failure");
        }
        return super.upsertChunksBulk(chunks);
      }
    }

    const tabular = new InMemoryTabularStorage(DocumentStorageSchema, DocumentStorageKey);
    await tabular.setupDatabase();
    const vector = new InMemoryVectorStorage(
      ChunkVectorStorageSchema,
      ChunkVectorPrimaryKey,
      [],
      3,
      Float32Array
    );
    await vector.setupDatabase();

    const kb = new FailingKb(
      `kb-ingest-order-${uuid4()}`,
      tabular as unknown as DocumentTabularStorage,
      vector as unknown as ChunkVectorStorage,
      { docEmbeddingModel: TEST_EMBED_MODEL_ID }
    );
    kb.setAiStrategy(createStandardKbStrategy());

    const docId = "doc-ingest-order";
    // First, plant the document + a stale chunk that the next ingest
    // should clear out.
    const initialRoot = await StructuralParser.parseMarkdown(
      uuid4(),
      "# Initial\n\nold content.",
      "Initial"
    );
    const initialDoc = new Document(initialRoot, { title: "Initial" });
    initialDoc.setDocId(docId);
    await kb.upsertDocument(initialDoc);
    await seedChunk(kb, docId, "stale-chunk-1");
    expect((await kb.getChunksForDocument(docId)).length).toBe(1);

    // Now arm the failure and re-ingest the same doc_id. The strategy
    // should: (1) delete the stale chunk, (2) upsert the new document
    // version, (3) chunk + embed, (4) call upsertChunksBulk which
    // throws. Post-failure: stale chunk still gone, document row
    // reflects the new (re-upserted) content.
    kb.failOnBulkInsert = true;
    const newRoot = await StructuralParser.parseMarkdown(
      uuid4(),
      "# Updated\n\nnew content.",
      "Updated"
    );
    const updatedDoc = new Document(newRoot, { title: "Updated" });
    updatedDoc.setDocId(docId);

    await expect(kb.upsert(updatedDoc)).rejects.toThrow(/simulated bulk-insert failure/);

    // Chunks: empty (stale gone, new ones never inserted) — the data-
    // integrity invariant of the new ordering.
    expect(await kb.getChunksForDocument(docId)).toEqual([]);
    // Document row: present (upserted before the failure), with the new
    // title — the new content "won" even though the chunks didn't.
    const storedDoc = await kb.getDocument(docId);
    expect(storedDoc).toBeDefined();
    expect(storedDoc!.metadata.title).toBe("Updated");
  });

  it("rerank mode tags results with scoreType: 'rerank' via the heuristic fallback (no rerankerModel)", async () => {
    const kb = await createKnowledgeBase({
      name: `kb-rerank-tag-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
      docEmbeddingModel: TEST_EMBED_MODEL_ID,
      searchMode: "rerank",
      // Intentionally no rerankerModel → heuristic RerankerTask fallback.
    });
    kb.setAiStrategy(createStandardKbStrategy());

    // Plant a doc + chunk so the first stage retrieves something for the
    // reranker to score.
    const docId = "doc-rerank-tag";
    const root = await StructuralParser.parseMarkdown(uuid4(), "# T\n\nhi.", "T");
    const doc = new Document(root, { title: "T" });
    doc.setDocId(docId);
    await kb.upsertDocument(doc);
    await seedChunk(kb, docId, "chunk-rerank-tag");

    const results = await kb.search("hi", { topK: 1 });

    expect(results.length).toBeGreaterThan(0);
    // The first-stage retrieval would have produced "cosine" scores; the
    // rerank fallback MUST override them to "rerank".
    for (const r of results) {
      expect(r.scoreType).toBe("rerank");
    }
  });
});

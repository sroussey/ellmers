/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkVectorPrimaryKey,
  ChunkVectorStorageSchema,
  Document,
  DocumentStorageKey,
  DocumentStorageSchema,
  KnowledgeBase,
  NodeKind,
  StructuralParser,
  createKnowledgeBase,
} from "@workglow/knowledge-base";
import type {
  ChunkVectorStorage,
  DocumentTabularStorage,
  SectionNode,
} from "@workglow/knowledge-base";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

import { snap, report } from "../../binding/testTiming";

let _snap = snap();
beforeEach(() => {
  _snap = snap();
});
afterEach(() => {
  report("doc-repo", _snap);
});

describe("DocumentRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("KnowledgeBase", () => {
    let kb: KnowledgeBase;

    beforeEach(async () => {
      kb = await createKnowledgeBase({
        name: `test-kb-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });
    });

    it("should store and retrieve documents", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test Document" });

      const inserted = await kb.upsertDocument(doc);
      const retrieved = await kb.getDocument(inserted.doc_id!);

      expect(retrieved).toBeDefined();
      expect(retrieved?.doc_id).toBeDefined();
      expect(retrieved?.doc_id).toBe(inserted.doc_id);
      expect(retrieved?.metadata.title).toBe("Test Document");
    });

    it("should retrieve nodes by ID", async () => {
      const markdown = "# Section\n\nParagraph.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Get a child node
      const firstChild = root.children[0];
      const retrieved = await kb.getNode(inserted.doc_id!, firstChild.nodeId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.nodeId).toBe(firstChild.nodeId);
    });

    it("should get ancestors of a node", async () => {
      const markdown = `# Section 1

## Subsection 1.1

Paragraph.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Find a deeply nested node
      const section = root.children.find((c): c is SectionNode => c.kind === NodeKind.SECTION);
      expect(section).toBeDefined();

      const subsection = section!.children.find((c) => c.kind === NodeKind.SECTION);
      expect(subsection).toBeDefined();

      const ancestors = await kb.getAncestors(inserted.doc_id!, subsection!.nodeId);

      // Should include root, section, and subsection
      expect(ancestors.length).toBeGreaterThanOrEqual(3);
      expect(ancestors[0].nodeId).toBe(root.nodeId);
      expect(ancestors[1].nodeId).toBe(section!.nodeId);
      expect(ancestors[2].nodeId).toBe(subsection!.nodeId);
    });

    it("should handle chunks", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });

      // Add chunks
      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id: doc_id,
          text: "Test chunk",
          nodePath: [root.nodeId],
          depth: 1,
        },
      ];

      doc.setChunks(chunks);

      const inserted = await kb.upsertDocument(doc);

      // Retrieve chunks from document JSON
      const retrievedChunks = await kb.getDocumentChunks(inserted.doc_id!);
      expect(retrievedChunks).toBeDefined();
      expect(retrievedChunks.length).toBe(1);
    });

    it("should list all documents", async () => {
      const markdown1 = "# Doc 1";
      const markdown2 = "# Doc 2";

      const id1 = uuid4();
      const id2 = uuid4();

      const root1 = await StructuralParser.parseMarkdown(id1, markdown1, "Doc 1");
      const root2 = await StructuralParser.parseMarkdown(id2, markdown2, "Doc 2");

      const doc1 = new Document(root1, { title: "Doc 1" });
      const doc2 = new Document(root2, { title: "Doc 2" });

      const inserted1 = await kb.upsertDocument(doc1);
      const inserted2 = await kb.upsertDocument(doc2);

      const list = await kb.listDocuments();
      expect(list.length).toBe(2);
      expect(list).toContain(inserted1.doc_id);
      expect(list).toContain(inserted2.doc_id);
    });

    it("should delete documents and cascade to chunks", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Add some chunks to vector storage
      await kb.upsertChunk({
        doc_id: inserted.doc_id!,
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { chunkId: "c1", doc_id: inserted.doc_id!, text: "test", nodePath: [], depth: 0 },
      });

      expect(await kb.getDocument(inserted.doc_id!)).toBeDefined();

      await kb.deleteDocument(inserted.doc_id!);

      expect(await kb.getDocument(inserted.doc_id!)).toBeUndefined();
    });

    it("should return undefined for non-existent document", async () => {
      const result = await kb.getDocument("non-existent-doc-id");
      expect(result).toBeUndefined();
    });

    it("should return undefined for node in non-existent document", async () => {
      const result = await kb.getNode("non-existent-doc-id", "some-node-id");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-existent node", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      const result = await kb.getNode(inserted.doc_id!, "non-existent-node-id");
      expect(result).toBeUndefined();
    });

    it("should return empty array for ancestors of non-existent document", async () => {
      const result = await kb.getAncestors("non-existent-doc-id", "some-node-id");
      expect(result).toEqual([]);
    });

    it("should return empty array for ancestors of non-existent node", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      const result = await kb.getAncestors(inserted.doc_id!, "non-existent-node-id");
      expect(result).toEqual([]);
    });

    it("should return empty array for chunks of non-existent document", async () => {
      const result = await kb.getDocumentChunks("non-existent-doc-id");
      expect(result).toEqual([]);
    });

    it("should return empty list for empty knowledge base", async () => {
      const emptyKb = await createKnowledgeBase({
        name: `empty-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });

      const result = await emptyKb.listDocuments();
      expect(result).toEqual([]);
    });

    it("should not throw when deleting non-existent document", async () => {
      // Just verify delete completes without error
      await kb.deleteDocument("non-existent-doc-id");
      // If we get here, it didn't throw
      expect(true).toBe(true);
    });

    it("should update existing document on upsert", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc1 = new Document(root, { title: "Original Title" });
      const inserted1 = await kb.upsertDocument(doc1);

      const doc2 = new Document(root, { title: "Updated Title" }, [], inserted1.doc_id);
      await kb.upsertDocument(doc2);

      const retrieved = await kb.getDocument(inserted1.doc_id!);
      expect(retrieved?.metadata.title).toBe("Updated Title");

      const list = await kb.listDocuments();
      expect(list.length).toBe(1);
    });

    it("should find chunks by node ID", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id: inserted.doc_id!,
          text: "First chunk",
          nodePath: [root.nodeId, "child-1"],
          depth: 2,
        },
        {
          chunkId: "chunk_2",
          doc_id: inserted.doc_id!,
          text: "Second chunk",
          nodePath: [root.nodeId, "child-2"],
          depth: 2,
        },
      ];
      inserted.setChunks(chunks);
      await kb.upsertDocument(inserted);

      const result = await kb.findChunksByNodeId(inserted.doc_id!, root.nodeId);
      expect(result.length).toBe(2);
    });

    it("should return empty array for findChunksByNodeId with no matches", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      doc.setChunks([]);
      const inserted = await kb.upsertDocument(doc);

      const result = await kb.findChunksByNodeId(inserted.doc_id!, "non-matching-node");
      expect(result).toEqual([]);
    });

    it("should return empty array for findChunksByNodeId with non-existent document", async () => {
      const result = await kb.findChunksByNodeId("non-existent-doc", "some-node");
      expect(result).toEqual([]);
    });

    it("should search with vector storage", async () => {
      // Add vectors to vector storage
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: {
          chunkId: "chunk_1",
          doc_id: "doc1",
          text: "First chunk",
          nodePath: [],
          depth: 0,
        },
      });
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([0.8, 0.2, 0.0]),
        metadata: {
          chunkId: "chunk_2",
          doc_id: "doc1",
          text: "Second chunk",
          nodePath: [],
          depth: 0,
        },
      });
      await kb.upsertChunk({
        doc_id: "doc2",
        vector: new Float32Array([0.0, 1.0, 0.0]),
        metadata: {
          chunkId: "chunk_3",
          doc_id: "doc2",
          text: "Third chunk",
          nodePath: [],
          depth: 0,
        },
      });

      const queryVector = new Float32Array([1.0, 0.0, 0.0]);
      const results = await kb.similaritySearch(queryVector, { topK: 2 });

      expect(results.length).toBe(2);
      expect(results[0].chunk_id).toBeDefined();
    });

    it("should search with score threshold", async () => {
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: {
          chunkId: "chunk_1",
          doc_id: "doc1",
          text: "Matching chunk",
          nodePath: [],
          depth: 0,
        },
      });
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([0.0, 1.0, 0.0]),
        metadata: {
          chunkId: "chunk_2",
          doc_id: "doc1",
          text: "Non-matching chunk",
          nodePath: [],
          depth: 0,
        },
      });

      const queryVector = new Float32Array([1.0, 0.0, 0.0]);
      const results = await kb.similaritySearch(queryVector, {
        topK: 10,
        scoreThreshold: 0.9,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      results.forEach((r: any) => {
        expect(r.score).toBeGreaterThanOrEqual(0.9);
      });
    });

    it("should support prepareReindex", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Add chunks
      await kb.upsertChunk({
        doc_id: inserted.doc_id!,
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { chunkId: "c1", doc_id: inserted.doc_id!, text: "test", nodePath: [], depth: 0 },
      });

      // PrepareReindex should delete chunks but keep document
      const reindexDoc = await kb.prepareReindex(inserted.doc_id!);
      expect(reindexDoc).toBeDefined();
      expect(reindexDoc?.doc_id).toBe(inserted.doc_id);

      // Document still exists
      const retrieved = await kb.getDocument(inserted.doc_id!);
      expect(retrieved).toBeDefined();
    });

    describe("createKnowledgeBase validation", () => {
      it("should throw when name is empty", async () => {
        await expect(
          createKnowledgeBase({ name: "", vectorDimensions: 3, register: false })
        ).rejects.toThrow("createKnowledgeBase: 'name' must be a non-empty string");
      });

      it("should throw when name is whitespace-only", async () => {
        await expect(
          createKnowledgeBase({ name: "   ", vectorDimensions: 3, register: false })
        ).rejects.toThrow("createKnowledgeBase: 'name' must be a non-empty string");
      });

      it("should throw when vectorDimensions is not a positive integer", async () => {
        await expect(
          createKnowledgeBase({ name: "kb", vectorDimensions: 0, register: false })
        ).rejects.toThrow("createKnowledgeBase: 'vectorDimensions' must be a positive integer");
        await expect(
          createKnowledgeBase({ name: "kb", vectorDimensions: -1, register: false })
        ).rejects.toThrow("createKnowledgeBase: 'vectorDimensions' must be a positive integer");
        await expect(
          createKnowledgeBase({ name: "kb", vectorDimensions: 1.5, register: false })
        ).rejects.toThrow("createKnowledgeBase: 'vectorDimensions' must be a positive integer");
      });
    });

    describe("ai strategy", () => {
      it("should throw a helpful error when kb.search() is called without a strategy", async () => {
        const bareKb = await createKnowledgeBase({
          name: `test-kb-nostrategy-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
        });

        await expect(bareKb.search("hello")).rejects.toThrow(/AI strategy/);
      });

      it("should invoke embedQuery and similaritySearch for kind: 'similarity'", async () => {
        const received: Array<{ text: string }> = [];
        const kb = await createKnowledgeBase({
          name: `test-kb-sim-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
        });
        kb.setAiStrategy({
          chunkAndEmbedDocument: async () => ({ chunks: [], vectors: [] }),
          embedQuery: async (text) => {
            received.push({ text });
            return new Float32Array([0.1, 0.2, 0.3]);
          },
          rerank: async (_q, candidates, topK) => candidates.slice(0, topK),
        });

        const results = await kb.search("hello", { kind: "similarity", topK: 4 });

        expect(received).toEqual([{ text: "hello" }]);
        expect(results).toEqual([]);
      });

      it("should run rerank by default when rerankerModel is configured", async () => {
        const reranks: Array<{ query: string; n: number; topK: number }> = [];
        const kb = await createKnowledgeBase({
          name: `test-kb-rerank-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
          docEmbeddingModel: "test:doc-embed",
          rerankerModel: "test:rerank",
        });
        kb.setAiStrategy({
          chunkAndEmbedDocument: async () => ({ chunks: [], vectors: [] }),
          embedQuery: async () => new Float32Array([1, 0, 0]),
          rerank: async (query, candidates, topK) => {
            reranks.push({ query, n: candidates.length, topK });
            return candidates.slice(0, topK);
          },
        });

        // Seed a chunk so the first-stage retrieval returns something the
        // reranker can score against.
        await kb.upsertChunk({
          chunk_id: "c1",
          doc_id: "d1",
          vector: new Float32Array([1, 0, 0]),
          metadata: { chunk_id: "c1", doc_id: "d1", text: "hi", nodePath: [], depth: 0 } as any,
        });

        await kb.search("q", { topK: 2 });

        expect(reranks).toHaveLength(1);
        expect(reranks[0].query).toBe("q");
        expect(reranks[0].topK).toBe(2);
      });

      it("should chunk+embed via the strategy in upsertDocumentWithIndex", async () => {
        const kb = await createKnowledgeBase({
          name: `test-kb-ingest-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
        });
        kb.setAiStrategy({
          chunkAndEmbedDocument: async (doc) => {
            const text = doc.metadata.title ?? "";
            return {
              chunks: [
                {
                  chunk_id: "c1",
                  doc_id: doc.doc_id ?? "",
                  text,
                  nodePath: [],
                  depth: 0,
                } as any,
              ],
              vectors: [new Float32Array([1, 0, 0])],
            };
          },
          embedQuery: async () => new Float32Array([0, 0, 0]),
          rerank: async (_q, c, k) => c.slice(0, k),
        });

        const root = await StructuralParser.parseMarkdown(uuid4(), "# Test\n\nx.", "Test");
        const doc = new Document(root, { title: "Test" });
        const stored = await kb.upsertDocumentWithIndex(doc);

        const chunks = await kb.getChunksForDocument(stored.doc_id!);
        expect(chunks).toHaveLength(1);
      });
    });
  });

  describe("KnowledgeBase virtual dispatch", () => {
    it("should let a subclass intercept similaritySearch and inject a filter that scopes results", async () => {
      const seenFilters: Array<Record<string, unknown> | undefined> = [];

      class ScopedStub extends KnowledgeBase {
        override async similaritySearch(
          query: Parameters<KnowledgeBase["similaritySearch"]>[0],
          options?: Parameters<KnowledgeBase["similaritySearch"]>[1]
        ) {
          seenFilters.push(options?.filter);
          return super.similaritySearch(query, {
            ...options,
            filter: { ...options?.filter, doc_id: "doc_a" },
          });
        }
      }

      const tabularStorage = new InMemoryTabularStorage(DocumentStorageSchema, DocumentStorageKey);
      await tabularStorage.setupDatabase();
      const vectorStorage = new InMemoryVectorStorage(
        ChunkVectorStorageSchema,
        ChunkVectorPrimaryKey,
        [],
        3,
        Float32Array
      );
      await vectorStorage.setupDatabase();

      const scoped = new ScopedStub(
        `test-kb-scope-${uuid4()}`,
        tabularStorage as unknown as DocumentTabularStorage,
        vectorStorage as unknown as ChunkVectorStorage
      );

      // Three chunks across two documents. The override will inject
      // `doc_id: "doc_a"`, so only the two chunks in doc_a should come back.
      await scoped.upsertChunk({
        doc_id: "doc_a",
        vector: new Float32Array([1, 0, 0]),
        metadata: { chunkId: "c1", doc_id: "doc_a", text: "A1", nodePath: [], depth: 0 },
      });
      await scoped.upsertChunk({
        doc_id: "doc_a",
        vector: new Float32Array([0.9, 0.1, 0]),
        metadata: { chunkId: "c2", doc_id: "doc_a", text: "A2", nodePath: [], depth: 0 },
      });
      await scoped.upsertChunk({
        doc_id: "doc_b",
        vector: new Float32Array([1, 0, 0]),
        metadata: { chunkId: "c3", doc_id: "doc_b", text: "B1", nodePath: [], depth: 0 },
      });

      const results = await scoped.similaritySearch(new Float32Array([1, 0, 0]), { topK: 10 });

      // Override ran, capturing the caller's filter (undefined here).
      expect(seenFilters).toEqual([undefined]);
      // Injected `doc_id: "doc_a"` actually narrowed results — the doc_b chunk
      // is dropped, proving the filter reached the storage layer.
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.doc_id === "doc_a")).toBe(true);
    });
  });

  describe("Document", () => {
    it("should manage chunks", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);

      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id,
          text: "Chunk 1",
          nodePath: [root.nodeId],
          depth: 1,
        },
      ];
      doc.setChunks(chunks);

      const retrievedChunks = doc.getChunks();
      expect(retrievedChunks.length).toBe(1);
      expect(retrievedChunks[0].text).toBe("Chunk 1");
    });

    it("should serialize and deserialize", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);

      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id,
          text: "Chunk",
          nodePath: [root.nodeId],
          depth: 1,
        },
      ];
      doc.setChunks(chunks);

      // Serialize (doc_id is NOT included in JSON)
      const json = doc.toJSON();
      expect(json).not.toHaveProperty("doc_id");

      // Deserialize (doc_id is passed separately)
      const restored = Document.fromJSON(JSON.stringify(json), doc_id);

      expect(restored.doc_id).toBe(doc.doc_id);
      expect(restored.metadata.title).toBe(doc.metadata.title);
      expect(restored.getChunks().length).toBe(1);
    });

    it("should find chunks by nodeId", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);

      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id,
          text: "First",
          nodePath: ["root", "section-a"],
          depth: 2,
        },
        {
          chunkId: "chunk_2",
          doc_id,
          text: "Second",
          nodePath: ["root", "section-b"],
          depth: 2,
        },
        {
          chunkId: "chunk_3",
          doc_id,
          text: "Third",
          nodePath: ["root", "section-a", "subsection"],
          depth: 3,
        },
      ];
      doc.setChunks(chunks);

      // Find chunks containing "section-a"
      const result = doc.findChunksByNodeId("section-a");
      expect(result.length).toBe(2);
      expect(result.map((c) => c.chunkId)).toContain("chunk_1");
      expect(result.map((c) => c.chunkId)).toContain("chunk_3");
    });

    it("should return empty array when no chunks match nodeId", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);

      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id,
          text: "First",
          nodePath: ["root", "section-a"],
          depth: 2,
        },
      ];
      doc.setChunks(chunks);

      const result = doc.findChunksByNodeId("non-existent-node");
      expect(result).toEqual([]);
    });

    it("should handle empty chunks in findChunksByNodeId", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);
      doc.setChunks([]);

      const result = doc.findChunksByNodeId("any-node");
      expect(result).toEqual([]);
    });

    it("should throw on invalid JSON object in fromJSON", () => {
      expect(() => Document.fromJSON("null")).toThrow("Document.fromJSON: expected a JSON object");
      expect(() => Document.fromJSON('"just a string"')).toThrow(
        "Document.fromJSON: expected a JSON object"
      );
    });

    it("should throw on missing or invalid root node in fromJSON", () => {
      expect(() =>
        Document.fromJSON(JSON.stringify({ metadata: { title: "T" }, chunks: [] }))
      ).toThrow("Document.fromJSON: missing or invalid 'root' node");
      expect(() =>
        Document.fromJSON(JSON.stringify({ root: {}, metadata: { title: "T" }, chunks: [] }))
      ).toThrow("Document.fromJSON: missing or invalid 'root' node");
    });

    it("should throw on missing or invalid metadata in fromJSON", () => {
      const stub = { root: { kind: "root" } };
      expect(() => Document.fromJSON(JSON.stringify({ ...stub, chunks: [] }))).toThrow(
        "Document.fromJSON: missing or invalid 'metadata'"
      );
      expect(() =>
        Document.fromJSON(JSON.stringify({ ...stub, metadata: { title: 42 }, chunks: [] }))
      ).toThrow("Document.fromJSON: missing or invalid 'metadata'");
    });

    it("should throw when chunks is not an array in fromJSON", () => {
      const stub = { root: { kind: "root" }, metadata: { title: "T" } };
      expect(() => Document.fromJSON(JSON.stringify({ ...stub, chunks: "not-an-array" }))).toThrow(
        "Document.fromJSON: 'chunks' must be an array if present"
      );
    });
  });
});

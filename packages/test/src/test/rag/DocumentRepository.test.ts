/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChunkVectorStorage,
  DocumentTabularStorage,
  SectionNode,
} from "@workglow/knowledge-base";
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
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { report, snap } from "../../binding/testTiming";

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

      it("should delegate kb.search to the installed strategy", async () => {
        const calls: Array<{ query: string; topK: number | undefined }> = [];
        const kb = await createKnowledgeBase({
          name: `test-kb-search-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
        });
        kb.setAiStrategy({
          ingest: async (_kb, doc) => doc,
          delete: async () => {},
          search: async (_kb, query, options) => {
            calls.push({ query, topK: options?.topK });
            return [];
          },
        });

        await kb.search("hello", { topK: 4 });

        expect(calls).toEqual([{ query: "hello", topK: 4 }]);
      });

      it("should delegate kb.upsert / kb.delete to the strategy", async () => {
        const ingested: string[] = [];
        const deleted: string[] = [];
        const kb = await createKnowledgeBase({
          name: `test-kb-ingest-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
        });
        kb.setAiStrategy({
          ingest: async (target, doc) => {
            await target.upsertDocument(doc);
            ingested.push(doc.doc_id ?? "");
            return doc;
          },
          delete: async (target, doc_id) => {
            deleted.push(doc_id);
            await target.deleteDocument(doc_id);
          },
          search: async () => [],
        });

        const root = await StructuralParser.parseMarkdown(uuid4(), "# T\n\nx.", "T");
        const doc = new Document(root, { title: "T" });
        doc.setDocId("d1");
        await kb.upsert(doc);
        expect(ingested).toEqual(["d1"]);

        await kb.delete("d1");
        expect(deleted).toEqual(["d1"]);
        expect(await kb.getDocument("d1")).toBeUndefined();
      });

      it("should expose model + chunk/search-mode config to the strategy", async () => {
        let observed: { docModel?: string; mode?: string; chunk?: string } = {};
        const kb = await createKnowledgeBase({
          name: `test-kb-config-${uuid4()}`,
          vectorDimensions: 3,
          register: false,
          docEmbeddingModel: "test:doc",
          rerankerModel: "test:rerank",
          chunkStrategy: "flat",
          searchMode: "rerank",
        });
        kb.setAiStrategy({
          ingest: async (_k, d) => d,
          delete: async () => {},
          search: async (target) => {
            observed = {
              docModel: target.docEmbeddingModel,
              mode: target.searchMode,
              chunk: target.chunkStrategy,
            };
            return [];
          },
        });
        await kb.search("q");
        expect(observed).toEqual({ docModel: "test:doc", mode: "rerank", chunk: "flat" });
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

  describe("strategy contract", () => {
    it("captures the strategy at op entry — mid-search setAiStrategy(B) doesn't redirect an in-flight search", async () => {
      const kb = await createKnowledgeBase({
        name: `kb-strategy-snapshot-search-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });

      let releaseA: () => void = () => {};
      const aPending = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      const aCalls: string[] = [];
      const bCalls: string[] = [];

      const strategyA = {
        ingest: async (_kb: KnowledgeBase, d: Document) => d,
        delete: async () => {},
        search: async () => {
          aCalls.push("search");
          await aPending;
          return [];
        },
      };
      const strategyB = {
        ingest: async (_kb: KnowledgeBase, d: Document) => d,
        delete: async () => {},
        search: async () => {
          bCalls.push("search");
          return [];
        },
      };

      kb.setAiStrategy(strategyA);
      const inFlight = kb.search("q1");
      // Swap mid-flight; the in-flight call must still resolve via A.
      kb.setAiStrategy(strategyB);
      releaseA();
      await inFlight;
      expect(aCalls).toEqual(["search"]);
      expect(bCalls).toEqual([]);

      // Subsequent call routes to B as expected.
      await kb.search("q2");
      expect(aCalls).toEqual(["search"]);
      expect(bCalls).toEqual(["search"]);
    });

    it("captures the strategy at op entry — mid-upsert setAiStrategy(B) doesn't redirect an in-flight upsert", async () => {
      const kb = await createKnowledgeBase({
        name: `kb-strategy-snapshot-upsert-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });

      let releaseA: () => void = () => {};
      const aPending = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      const aCalls: string[] = [];
      const bCalls: string[] = [];

      const strategyA = {
        ingest: async (_target: KnowledgeBase, d: Document) => {
          aCalls.push("ingest");
          await aPending;
          return d;
        },
        delete: async () => {},
        search: async () => [],
      };
      const strategyB = {
        ingest: async (_target: KnowledgeBase, d: Document) => {
          bCalls.push("ingest");
          return d;
        },
        delete: async () => {},
        search: async () => [],
      };

      kb.setAiStrategy(strategyA);
      const root = await StructuralParser.parseMarkdown(uuid4(), "# T\n\nx.", "T");
      const doc = new Document(root, { title: "T" });
      doc.setDocId("doc-snapshot-upsert");
      const inFlight = kb.upsert(doc);
      kb.setAiStrategy(strategyB);
      releaseA();
      await inFlight;
      expect(aCalls).toEqual(["ingest"]);
      expect(bCalls).toEqual([]);
    });

    it("chunkText helper throws with chunk_id when metadata.text is missing", async () => {
      const { chunkText } = await import("@workglow/knowledge-base");
      expect(() =>
        chunkText({
          chunk_id: "c-no-text",
          metadata: { custom: "x" } as unknown as Parameters<typeof chunkText>[0]["metadata"],
        })
      ).toThrow(/c-no-text/);
    });

    it("chunkText helper returns metadata.text when present", async () => {
      const { chunkText } = await import("@workglow/knowledge-base");
      const text = chunkText({
        chunk_id: "c-has-text",
        metadata: { text: "hello" } as unknown as Parameters<typeof chunkText>[0]["metadata"],
      });
      expect(text).toBe("hello");
    });

    it("captures the strategy once at reindex() entry — mid-loop swap doesn't redirect remaining iterations", async () => {
      const kb = await createKnowledgeBase({
        name: `kb-strategy-snapshot-reindex-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });

      const aIngested: string[] = [];
      const bIngested: string[] = [];
      const strategyA = {
        ingest: async (target: KnowledgeBase, d: Document) => {
          aIngested.push(d.doc_id ?? "");
          // Swap to B partway through; the reindex loop should keep
          // ingesting via A for the rest of this run.
          target.setAiStrategy(strategyB);
          return d;
        },
        delete: async () => {},
        search: async () => [],
      };
      const strategyB = {
        ingest: async (_target: KnowledgeBase, d: Document) => {
          bIngested.push(d.doc_id ?? "");
          return d;
        },
        delete: async () => {},
        search: async () => [],
      };

      // Seed three documents through the storage layer directly so they're
      // present for reindex to iterate.
      for (let i = 0; i < 3; i++) {
        const root = await StructuralParser.parseMarkdown(uuid4(), `# D${i}\n\nx.`, `D${i}`);
        const doc = new Document(root, { title: `D${i}` });
        doc.setDocId(`doc-reindex-${i}`);
        await kb.upsertDocument(doc);
      }

      kb.setAiStrategy(strategyA);
      const processed = await kb.reindex();
      expect(processed).toBe(3);
      // All three iterations stayed on A even though A re-installed B
      // after the first call.
      expect(aIngested).toHaveLength(3);
      expect(bIngested).toHaveLength(0);
      // The KB's current strategy is now B (set during the loop).
      expect(kb.getAiStrategy()).toBe(strategyB);
    });
  });
});

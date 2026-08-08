/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Complete End-to-End RAG Pipeline Test
 *
 * Stage 1 - Document Ingestion Pipeline:
 *   FileLoader -> StructuralParser -> DocumentEnricher -> HierarchicalChunker
 *   -> TextEmbedding -> ChunkVectorUpsert
 *
 * Stage 2 - Query Retrieval Pipeline:
 *   ChunkRetrieval -> Reranker -> ContextBuilder
 *
 * RAG Tasks Demonstrated (category = "RAG"):
 *   1. ChunkRetrievalTask - Embed query and search; supports similarity + hybrid methods
 *   2. RerankerTask - Heuristic reranking (simple / reciprocal-rank-fusion)
 *   3. ContextBuilderTask - Format chunks into context for LLM prompts
 *   4. QueryExpanderTask - Rule-based query variations for improved recall
 *   5. HierarchyJoinTask - Enrich results with document hierarchy context
 */

import type {
  ChunkRetrievalTaskOutput,
  ContextBuilderTaskOutput,
  HierarchyJoinTaskOutput,
  QueryExpanderTaskOutput,
  RerankerTaskOutput,
} from "@workglow/ai";
import { InMemoryModelRepository, setGlobalModelRepository } from "@workglow/ai";
import {
  clearPipelineCache,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import type { KnowledgeBase } from "@workglow/knowledge-base";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { ResourceScope, setLogger } from "@workglow/util";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
export { FileLoaderTask } from "@workglow/tasks";

import { getTestingLogger } from "@workglow/util/test";
import { registerHuggingfaceLocalModels } from "../../samples/ONNXModelSamples";

import { report, snap } from "../../binding/testTiming";

describe("End-to-End RAG Pipeline", () => {
  // In CI, skip summary/NER in document enricher to avoid flaky ONNX model downloads
  const isCI = !!process.env.CI;

  // Configuration - Models
  const embeddingModel = "onnx:Qwen3-Embedding-0.6B:auto";
  const summaryModel = "onnx:Falconsai/text_summarization:fp32";
  const nerModel = "onnx:onnx-community/NeuroBERT-NER-ONNX:q8";

  // Configuration - Knowledge Base
  const kbName = "e2e-rag-test-kb";
  const sampleFileName = "history_of_the_united_states.md";

  let kb: KnowledgeBase;
  // Shared across every workflow.run() in this file so loaded models stay
  // warm until afterAll. Without this, each workflow's auto-created scope
  // disposes (unloads) every model the workflow used as soon as run() returns.
  let resourceScope: ResourceScope;
  const logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    // Setup task queue and model repository
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await clearPipelineCache();
    await registerHuggingFaceTransformersInline();
    await registerHuggingfaceLocalModels();

    resourceScope = new ResourceScope();

    // Create unified KnowledgeBase with 1024 dimensions for Qwen3 model
    kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: 1024,
    });
  });

  afterAll(async () => {
    const beforeDispose = snap();
    kb.destroy();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
    await resourceScope.disposeAll();
    await clearPipelineCache();
    report("e2e-rag: dispose", beforeDispose);
  });

  it("should ingest document through complete pipeline", async () => {
    const s = snap();
    const sampleFilePath = join(__dirname, sampleFileName);

    logger.info(`\n=== Stage 1: Document Ingestion ===`);
    logger.info(`Processing: ${sampleFileName}`);

    const ingestionWorkflow = new Workflow()
      .fileLoader({
        url: `file://${sampleFilePath}`,
        format: "markdown",
      })
      .structuralParser({
        title: "A Concise History of the United States of America",
        format: "markdown",
        sourceUri: sampleFilePath,
      })
      .documentEnricher({
        generateSummaries: !isCI,
        summaryModel,
        extractEntities: !isCI,
        nerModel,
      })
      .hierarchicalChunker({
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      })
      .textEmbedding({
        model: embeddingModel,
      })
      .chunkVectorUpsert({
        knowledgeBase: kbName,
      });

    expect(ingestionWorkflow.error).toBe("");

    const result = await ingestionWorkflow.run({}, { resourceScope });

    expect(result).toBeDefined();
    expect(result.count).toBeGreaterThan(0);
    expect(result.doc_id).toBeDefined();
    expect(result.chunk_ids).toBeDefined();
    expect(result.chunk_ids.length).toBe(result.count);

    logger.info(`  -> Document ID: ${result.doc_id}`);
    logger.info(`  -> Stored ${result.count} vectors`);
    logger.info(`  -> Chunk IDs: ${result.chunk_ids.slice(0, 3).join(", ")}...`);
    report("e2e-rag: ingest", s);
  }, 160000);

  it("should retrieve relevant chunks via query workflow", async () => {
    const s = snap();
    const query = "What caused the Civil War?";

    logger.info(`\n=== Stage 2: Query Retrieval ===`);
    logger.info(`Query: "${query}"`);

    const retrievalWorkflow = new Workflow()
      .chunkRetrieval({
        knowledgeBase: kbName,
        query,
        model: embeddingModel,
        topK: 10,
        scoreThreshold: 0.1,
      })
      .reranker({
        query,
        method: "simple",
        topK: 5,
      })
      .contextBuilder({
        format: "numbered",
        includeMetadata: false,
        separator: "\n\n---\n\n",
      });

    expect(retrievalWorkflow.error).toBe("");

    const result = (await retrievalWorkflow.run({}, { resourceScope })) as ContextBuilderTaskOutput;

    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(typeof result.context).toBe("string");
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.chunksUsed).toBeGreaterThan(0);
    expect(result.chunksUsed).toBeLessThanOrEqual(5);
    expect(result.totalLength).toBe(result.context.length);

    logger.info(`  -> Built context from ${result.chunksUsed} chunks`);
    logger.info(`  -> Total context length: ${result.totalLength} characters`);

    const contextLower = result.context.toLowerCase();
    const relevantTerms = [
      "civil",
      "war",
      "slavery",
      "union",
      "confederate",
      "secession",
      "lincoln",
    ];
    const hasRelevantContent = relevantTerms.some((term) => contextLower.includes(term));
    expect(hasRelevantContent).toBe(true);
    report("e2e-rag: retrieval", s);
  }, 120000);

  it("should answer questions about US history", async () => {
    const s = snap();
    const questions = [
      {
        query: "When did the American Revolution begin?",
        expectedTerms: ["revolution", "colonial", "1775", "independence", "british", "war"],
      },
      {
        query: "What was the Great Depression?",
        expectedTerms: ["depression", "economic", "1929", "crash", "new deal", "federal"],
      },
      {
        query: "Who led the Continental Army?",
        expectedTerms: ["washington", "army", "continental", "military", "war", "general"],
      },
    ];

    logger.info(`\n=== Quality Verification ===`);

    let totalQueriesWithResults = 0;

    for (const { query, expectedTerms } of questions) {
      logger.info(`\nQuery: "${query}"`);

      const workflow = new Workflow().chunkRetrieval({
        knowledgeBase: kbName,
        query,
        model: embeddingModel,
        topK: 3,
        scoreThreshold: 0.0,
      });

      const result = (await workflow.run({}, { resourceScope })) as ChunkRetrievalTaskOutput;

      expect(result.chunks).toBeDefined();

      if (result.chunks.length === 0) {
        logger.info(`  -> No chunks found`);
        continue;
      }

      logger.info(`  -> Found ${result.chunks.length} chunks`);

      const allChunksText = result.chunks.join(" ").toLowerCase();
      const foundTerms = expectedTerms.filter((term) => allChunksText.includes(term.toLowerCase()));

      logger.info(`  -> Matched terms: ${foundTerms.join(", ") || "none"}`);

      if (foundTerms.length > 0) {
        totalQueriesWithResults++;
      }
    }

    expect(totalQueriesWithResults).toBeGreaterThanOrEqual(1);
    report("e2e-rag: qa-history", s);
  }, 180000);

  it("should use QueryExpander to generate query variations", async () => {
    const s = snap();
    const query = "What were the major battles of World War II?";

    logger.info(`\n=== QueryExpander RAG Task ===`);
    logger.info(`Original query: "${query}"`);

    const expanderWorkflow = new Workflow().queryExpander({
      query,
      method: "multi-query",
      numVariations: 3,
    });

    expect(expanderWorkflow.error).toBe("");

    const expanderResult = (await expanderWorkflow.run(
      {},
      { resourceScope }
    )) as QueryExpanderTaskOutput;

    expect(expanderResult).toBeDefined();
    expect(expanderResult.query).toBeDefined();
    expect(Array.isArray(expanderResult.query)).toBe(true);
    expect(expanderResult.query.length).toBeGreaterThan(1);
    expect(expanderResult.originalQuery).toBe(query);

    logger.info(`\n  -> Retrieving chunks for each query variation:`);
    let totalChunksFound = 0;

    for (const expandedQuery of expanderResult.query.slice(0, 2)) {
      const retrievalWorkflow = new Workflow()
        .chunkRetrieval({
          knowledgeBase: kbName,
          query: expandedQuery,
          model: embeddingModel,
          topK: 3,
          scoreThreshold: 0.0,
        })
        .reranker({
          query: expandedQuery,
          method: "simple",
          topK: 2,
        });

      const result = (await retrievalWorkflow.run({}, { resourceScope })) as RerankerTaskOutput;
      totalChunksFound += result.count;
    }

    expect(totalChunksFound).toBeGreaterThan(0);
    report("e2e-rag: query-expander", s);
  }, 180000);

  it("should use ContextBuilder with different formats", async () => {
    const s = snap();
    const query = "What was the Declaration of Independence?";

    logger.info(`\n=== ContextBuilder Format Options ===`);

    const retrievalWorkflow = new Workflow().chunkRetrieval({
      knowledgeBase: kbName,
      query,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.0,
    });

    const retrievalResult = (await retrievalWorkflow.run(
      {},
      { resourceScope }
    )) as ChunkRetrievalTaskOutput;
    expect(retrievalResult.chunks.length).toBeGreaterThan(0);

    const formats = ["simple", "numbered", "xml", "markdown"] as const;

    for (const format of formats) {
      const contextWorkflow = new Workflow().contextBuilder({
        chunks: retrievalResult.chunks,
        scores: retrievalResult.scores,
        format,
        includeMetadata: format !== "simple",
        maxLength: 1000,
      });

      expect(contextWorkflow.error).toBe("");

      const contextResult = (await contextWorkflow.run(
        {},
        { resourceScope }
      )) as ContextBuilderTaskOutput;

      expect(contextResult.context).toBeDefined();
      expect(contextResult.chunksUsed).toBeGreaterThan(0);
    }
    report("e2e-rag: context-builder", s);
  }, 120000);

  it("should use ChunkRetrieval in hybrid mode for combined vector + text search", async () => {
    const s = snap();
    const query = "Civil War slavery abolition Lincoln";

    logger.info(`\n=== ChunkRetrieval (hybrid) ===`);

    // In-memory KB does not support hybrid search; skip cleanly.
    if (!kb.supportsHybridSearch()) {
      logger.info("Skipping: knowledge base does not support hybrid search");
      report("e2e-rag: hybrid", s);
      return;
    }

    const hybridWorkflow = new Workflow().chunkRetrieval({
      knowledgeBase: kbName,
      query,
      model: embeddingModel,
      method: "hybrid",
      topK: 5,
      vectorWeight: 0.7,
      scoreThreshold: 0.0,
    });

    expect(hybridWorkflow.error).toBe("");

    const result = (await hybridWorkflow.run({}, { resourceScope })) as ChunkRetrievalTaskOutput;

    expect(result).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.count).toBe(result.chunks.length);

    const allChunksText = result.chunks.join(" ").toLowerCase();
    const relevantTerms = ["civil", "war", "slavery", "lincoln", "union", "emancipation"];
    const foundTerms = relevantTerms.filter((term) => allChunksText.includes(term));
    expect(foundTerms.length).toBeGreaterThan(0);
    report("e2e-rag: hybrid", s);
  }, 120000);

  it("should use HierarchyJoinTask to enrich results with document context", async () => {
    const s = snap();
    const query = "American Revolution independence";

    logger.info(`\n=== HierarchyJoinTask ===`);

    const hierarchyWorkflow = new Workflow()
      .chunkRetrieval({
        knowledgeBase: kbName,
        query,
        model: embeddingModel,
        topK: 3,
        scoreThreshold: 0.0,
      })
      .hierarchyJoin({
        knowledgeBase: kbName,
        includeParentSummaries: true,
        includeEntities: true,
      });

    expect(hierarchyWorkflow.error).toBe("");

    const result = (await hierarchyWorkflow.run({}, { resourceScope })) as HierarchyJoinTaskOutput;

    expect(result).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(Array.isArray(result.metadata)).toBe(true);
    expect(result.count).toBe(result.metadata.length);
    report("e2e-rag: hierarchy-join", s);
  }, 120000);

  it("should demonstrate workflow composability", async () => {
    const s = snap();
    logger.info(`\n=== Workflow Composability Test ===`);

    const ingestionWorkflow = new Workflow()
      .fileLoader({ url: "file:///test.md", format: "markdown" })
      .structuralParser({ title: "Test" })
      .documentEnricher({})
      .hierarchicalChunker({ maxTokens: 512 })
      .textEmbedding({ model: embeddingModel })
      .chunkVectorUpsert({ knowledgeBase: kbName });

    const tasks = ingestionWorkflow.graph.getTasks();
    expect(tasks.length).toBe(6);

    const taskTypes = tasks.map((t) => t.type);
    expect(taskTypes).toContain("FileLoaderTask");
    expect(taskTypes).toContain("StructuralParserTask");
    expect(taskTypes).toContain("DocumentEnricherTask");
    expect(taskTypes).toContain("HierarchicalChunkerTask");
    expect(taskTypes).toContain("TextEmbeddingTask");
    expect(taskTypes).toContain("ChunkVectorUpsertTask");

    const retrievalWorkflow = new Workflow()
      .chunkRetrieval({ knowledgeBase: kbName, query: "test", model: embeddingModel })
      .hierarchyJoin({ knowledgeBase: kbName })
      .reranker({ query: "test", method: "simple", topK: 5 })
      .contextBuilder({ format: "numbered", includeMetadata: true });

    const retrievalTasks = retrievalWorkflow.graph.getTasks();
    expect(retrievalTasks.length).toBe(4);
    expect(retrievalWorkflow.error).toBe("");

    const hybridRetrievalWorkflow = new Workflow()
      .chunkRetrieval({
        knowledgeBase: kbName,
        query: "test query",
        model: embeddingModel,
        method: "hybrid",
        topK: 5,
      })
      .reranker({ query: "test query", method: "simple", topK: 3 })
      .contextBuilder({ format: "markdown" });

    const hybridTasks = hybridRetrievalWorkflow.graph.getTasks();
    expect(hybridTasks.length).toBe(3);
    expect(hybridRetrievalWorkflow.error).toBe("");
    report("e2e-rag: composability", s);
  });
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RAG (Retrieval Augmented Generation) Workflow End-to-End Test
 *
 * This test demonstrates a complete RAG pipeline using the Workflow API
 * in a way that's compatible with visual node editors.
 *
 * Models Used:
 *    - Xenova/all-MiniLM-L6-v2:q8 (Text Embedding - 384D)
 *    - onnx-community/NeuroBERT-NER-ONNX:q8 (Named Entity Recognition)
 *    - Xenova/distilbert-base-uncased-distilled-squad (Question Answering)
 */

import type {
  ChunkRetrievalTaskOutput,
  TextQuestionAnswerTaskOutput,
  VectorStoreUpsertTaskOutput,
} from "@workglow/ai";
import {
  chunkRetrieval,
  InMemoryModelRepository,
  setGlobalModelRepository,
  textQuestionAnswer,
} from "@workglow/ai";
import {
  clearPipelineCache,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import type { KnowledgeBase } from "@workglow/knowledge-base";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { ResourceScope, setLogger } from "@workglow/util";
import { readdirSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
export { FileLoaderTask } from "@workglow/tasks";

import { getTestingLogger } from "@workglow/util/test";
import { registerHuggingfaceLocalModels } from "../../samples/ONNXModelSamples";

import { report, snap } from "../../binding/testTiming";

describe("RAG Workflow End-to-End", () => {
  const kbName = "rag-test-kb";
  const embeddingModel = "onnx:Xenova/all-MiniLM-L6-v2:q8";
  const summaryModel = "onnx:Falconsai/text_summarization:fp32";
  const nerModel = "onnx:onnx-community/NeuroBERT-NER-ONNX:q8";
  const qaModel = "onnx:onnx-community/ModernBERT-finetuned-squad-ONNX";
  let kb: KnowledgeBase;
  // Shared across every workflow.run() so loaded models stay warm until
  // afterAll. Without this, each workflow's auto-created scope disposes
  // every model the workflow used as soon as run() returns.
  let resourceScope: ResourceScope;
  const logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await clearPipelineCache();
    await registerHuggingFaceTransformersInline();
    await registerHuggingfaceLocalModels();
    resourceScope = new ResourceScope();
    kb = await createKnowledgeBase({
      name: kbName,
      vectorDimensions: 384,
    });
  });

  afterAll(async () => {
    const beforeDispose = snap();
    kb.destroy();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
    await resourceScope.disposeAll();
    // Release ONNX/WASM memory at the end of the suite. Symmetric with
    // EndToEnd's afterAll so neighbouring files in the same bun-test invocation
    // start fresh.
    await clearPipelineCache();
    report("rag-wf: dispose", beforeDispose);
  });

  it("should ingest markdown documents with NER enrichment", async () => {
    const s = snap();
    // Find markdown files in docs folder
    const docsPath = join(process.cwd(), "docs", "technical");
    const files = readdirSync(docsPath).filter((f) => f.endsWith(".md"));

    logger.info(`Found ${files.length} markdown files to process`);

    let totalVectors = 0;

    for (const file of files) {
      const filePath = join(docsPath, file);
      logger.info(`Processing: ${file}`);

      const ingestionWorkflow = new Workflow();

      ingestionWorkflow
        .fileLoader({ url: `file://${filePath}`, format: "markdown" })
        .structuralParser({
          title: filePath.split("/").pop()?.split(".")[0] || "",
          format: "markdown",
          sourceUri: filePath,
        })
        .documentEnricher({
          generateSummaries: false,
          extractEntities: false,
          summaryModel,
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

      const result = (await ingestionWorkflow.run(
        {},
        { resourceScope }
      )) as VectorStoreUpsertTaskOutput;

      logger.info(`  -> Stored ${result.count} vectors`);
      totalVectors += result.count;
    }

    // Verify vectors were stored
    expect(totalVectors).toBeGreaterThan(0);
    logger.info(`Total vectors in knowledge base: ${totalVectors}`);
    report("rag-wf: ingest", s);
  }, 600000);

  it("should search for relevant content", async () => {
    const s = snap();
    const query = "What is retrieval augmented generation?";

    logger.info(`\nSearching for: "${query}"`);

    const searchWorkflow = new Workflow();

    searchWorkflow.chunkRetrieval({
      knowledgeBase: kbName,
      query,
      model: embeddingModel,
      topK: 5,
      scoreThreshold: 0.3,
    });

    const searchResult = (await searchWorkflow.run(
      {},
      { resourceScope }
    )) as ChunkRetrievalTaskOutput;

    expect(searchResult.chunks).toBeDefined();
    expect(Array.isArray(searchResult.chunks)).toBe(true);
    expect(searchResult.chunks.length).toBeGreaterThan(0);
    expect(searchResult.chunks.length).toBeLessThanOrEqual(5);
    expect(searchResult.scores).toBeDefined();
    expect(searchResult.scores!.length).toBe(searchResult.chunks.length);

    logger.info(`Found ${searchResult.chunks.length} relevant chunks`);

    // Verify scores are in descending order
    for (let i = 1; i < searchResult.scores!.length; i++) {
      expect(searchResult.scores![i]).toBeLessThanOrEqual(searchResult.scores![i - 1]);
    }
    report("rag-wf: search", s);
  }, 600000);

  it("should answer questions using retrieved context", async () => {
    const s = snap();
    const question = "What is RAG?";

    logger.info(`\nAnswering question: "${question}"`);

    const retrievalResult = await chunkRetrieval({
      knowledgeBase: kbName,
      query: question,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.2,
    });

    expect(retrievalResult.chunks).toBeDefined();

    if (retrievalResult.chunks.length === 0) {
      logger.info("No relevant chunks found, skipping QA");
      report("rag-wf: qa", s);
      return;
    }

    const context = retrievalResult.chunks.join("\n\n");

    const answer = await textQuestionAnswer({
      context,
      question,
      model: qaModel,
    });

    expect(answer.text).toBeDefined();
    expect(typeof answer.text).toBe("string");
    if (answer.text.length > 0) {
      logger.info(`\nAnswer: ${answer.text}`);
    }
    report("rag-wf: qa", s);
  }, 600000);

  it("should handle complex multi-step RAG pipeline", async () => {
    const s = snap();
    const question = "How does vector search work?";

    logger.info(`\nComplex RAG pipeline for: "${question}"`);

    const retrievalWorkflow = new Workflow();
    retrievalWorkflow.chunkRetrieval({
      knowledgeBase: kbName,
      query: question,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.2,
    });

    const retrievalResult = (await retrievalWorkflow.run(
      {},
      { resourceScope }
    )) as ChunkRetrievalTaskOutput;

    if (retrievalResult.chunks.length === 0) {
      logger.info("No chunks found, skipping QA step");
      report("rag-wf: complex-pipeline", s);
      return;
    }

    const context = retrievalResult.chunks.join("\n\n");
    const qaWorkflow = new Workflow();
    qaWorkflow.textQuestionAnswer({
      context,
      question,
      model: qaModel,
    });

    const result = (await qaWorkflow.run({}, { resourceScope })) as TextQuestionAnswerTaskOutput;

    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe("string");
    report("rag-wf: complex-pipeline", s);
  }, 600000);
});

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

import {
  chunkRetrieval,
  ChunkRetrievalTaskOutput,
  InMemoryModelRepository,
  setGlobalModelRepository,
  textQuestionAnswer,
  TextQuestionAnswerTaskOutput,
  VectorStoreUpsertTaskOutput,
} from "@workglow/ai";
import {
  clearPipelineCache,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import { createKnowledgeBase, KnowledgeBase } from "@workglow/knowledge-base";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { ResourceScope, setLogger } from "@workglow/util";
import { readdirSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
export { FileLoaderTask } from "@workglow/tasks";

import { getTestingLogger } from "../../binding/TestingLogger";
import { registerHuggingfaceLocalModels } from "../../samples/ONNXModelSamples";

type MemSnapshot = ReturnType<typeof process.memoryUsage>;
const mb = (n: number) => (n / 1024 / 1024).toFixed(0) + "MB";
const signedMb = (n: number) => (n >= 0 ? "+" : "") + (n / 1024 / 1024).toFixed(0) + "MB";
const snapMem = (): MemSnapshot => process.memoryUsage();
const reportMem = (label: string, start?: MemSnapshot) => {
  const m = process.memoryUsage();
  const fmt = (cur: number, base: number | undefined) =>
    base === undefined ? mb(cur) : `${mb(cur)} (${signedMb(cur - base)})`;
  process.stderr.write(
    `[${label}] MEM rss=${fmt(m.rss, start?.rss)} heap=${fmt(m.heapUsed, start?.heapUsed)} ext=${fmt(m.external, start?.external)} ab=${fmt(m.arrayBuffers, start?.arrayBuffers)}\n`
  );
};
const reportTime = (label: string, started: number) => {
  process.stderr.write(`[${label}] TIME ${((Date.now() - started) / 1000).toFixed(2)}s\n`);
};

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
    reportMem("rag-wf before dispose");
    const beforeDispose = snapMem();
    kb.destroy();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
    await resourceScope.disposeAll();
    // Release ONNX/WASM memory at the end of the suite. Symmetric with
    // EndToEnd's afterAll so neighbouring files in the same bun-test invocation
    // start fresh.
    await clearPipelineCache();
    reportMem("rag-wf after dispose", beforeDispose);
  });

  it("should ingest markdown documents with NER enrichment", async () => {
    const started = Date.now();
    const startMem = snapMem();
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
    reportTime("rag-wf: ingest", started);
    reportMem("rag-wf: ingest", startMem);
  }, 600000);

  it("should search for relevant content", async () => {
    const started = Date.now();
    const startMem = snapMem();
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
    reportTime("rag-wf: search", started);
    reportMem("rag-wf: search", startMem);
  }, 600000);

  it("should answer questions using retrieved context", async () => {
    const started = Date.now();
    const startMem = snapMem();
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
      reportTime("rag-wf: qa", started);
      reportMem("rag-wf: qa", startMem);
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
    reportTime("rag-wf: qa", started);
    reportMem("rag-wf: qa", startMem);
  }, 600000);

  it("should handle complex multi-step RAG pipeline", async () => {
    const started = Date.now();
    const startMem = snapMem();
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
      reportTime("rag-wf: complex-pipeline", started);
      reportMem("rag-wf: complex-pipeline", startMem);
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
    reportTime("rag-wf: complex-pipeline", started);
    reportMem("rag-wf: complex-pipeline", startMem);
  }, 600000);
});

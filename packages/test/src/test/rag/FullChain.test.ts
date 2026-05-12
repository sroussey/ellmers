/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { HierarchicalChunkerTaskOutput } from "@workglow/ai";
import { ChunkRecord } from "@workglow/knowledge-base";
import { setLogger, uuid4 } from "@workglow/util";
import { Workflow } from "@workglow/task-graph";
import { beforeAll, describe, expect, it } from "vitest";
import { registerTasks } from "../../binding/RegisterTasks";
import { getTestingLogger } from "../../binding/TestingLogger";

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

describe("Complete chainable workflow", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeAll(async () => {
    registerTasks();
  });

  it("should chain from parsing to storage without loops", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const markdown = `# Test Document

## Section 1

This is the first section with some content.

## Section 2

This is the second section with more content.`;

    // Parse -> Enrich -> Chunk
    const result = await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test Doc",
        format: "markdown",
        sourceUri: "test.md",
      })
      .documentEnricher({
        generateSummaries: true,
        extractEntities: true,
      })
      .hierarchicalChunker({
        maxTokens: 256,
        overlap: 25,
        strategy: "hierarchical",
      })
      .run();

    // Verify the chain worked - final output from hierarchicalChunker
    expect(result.doc_id).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.count).toBeGreaterThan(0);

    // Verify output structure matches expectations
    expect(result.chunks.length).toBe(result.count);
    expect(result.text.length).toBe(result.count);
    reportTime("full-chain: parse+chunk", started);
    reportMem("full-chain: parse+chunk", startMem);
  });

  it("should demonstrate data flow through chain", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const markdown = "# Title\n\nParagraph content.";

    const result = await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test",
        format: "markdown",
      })
      .hierarchicalChunker({
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      })
      .run();

    // Verify data flows correctly (final output from hierarchicalChunker)
    expect(result.doc_id).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.text).toBeDefined();

    // doc_id should flow through the chain to all chunks
    const chunks = (
      Array.isArray(result.chunks) && result.chunks.length > 0
        ? Array.isArray(result.chunks[0])
          ? result.chunks.flat()
          : result.chunks
        : []
    ) as ChunkRecord[];
    for (const chunk of chunks) {
      expect(chunk.doc_id).toBe(result.doc_id);
    }
    reportTime("full-chain: data-flow", started);
    reportMem("full-chain: data-flow", startMem);
  });

  it("should allow doc_id override for variant creation", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const markdown = "# Test\n\nContent.";
    const customId = uuid4();

    const result = (await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test",
        doc_id: customId, // Override with custom ID
      })
      .hierarchicalChunker({
        maxTokens: 512,
      })
      .run()) as HierarchicalChunkerTaskOutput;

    // Should use the provided ID
    expect(result.doc_id).toBe(customId);

    // All chunks should reference it
    for (const chunk of result.chunks) {
      expect(chunk.doc_id).toBe(customId);
    }
    reportTime("full-chain: doc-id-override", started);
    reportMem("full-chain: doc-id-override", startMem);
  });
});

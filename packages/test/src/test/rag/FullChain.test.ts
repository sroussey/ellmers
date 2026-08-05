/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HierarchicalChunkerTaskOutput } from "@workglow/ai";
import type { ChunkRecord } from "@workglow/knowledge-base";
import { Workflow } from "@workglow/task-graph";
import { setLogger, uuid4 } from "@workglow/util";
import { beforeAll, describe, expect, it } from "vitest";
import { registerTasks } from "../../binding/RegisterTasks";
import { getTestingLogger } from "../../binding/TestingLogger";

import { report, snap } from "../../binding/testTiming";

describe("Complete chainable workflow", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeAll(async () => {
    registerTasks();
  });

  it("should chain from parsing to storage without loops", async () => {
    const s = snap();
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
    report("full-chain: parse+chunk", s);
  });

  it("should demonstrate data flow through chain", async () => {
    const s = snap();
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
    report("full-chain: data-flow", s);
  });

  it("should allow doc_id override for variant creation", async () => {
    const s = snap();
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
    report("full-chain: doc-id-override", s);
  });
});

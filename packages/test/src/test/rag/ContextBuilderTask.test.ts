/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ContextFormat, contextBuilder } from "@workglow/ai";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { report, snap } from "../../binding/testTiming";

let _snap = snap();
beforeEach(() => {
  _snap = snap();
});
afterEach(() => {
  report("ctx-builder", _snap);
});

describe("ContextBuilderTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const testChunks = [
    "First chunk of text about artificial intelligence.",
    "Second chunk discussing machine learning algorithms.",
    "Third chunk covering neural networks and deep learning.",
  ];

  const testMetadata = [
    { source: "doc1.txt", page: 1 },
    { source: "doc2.txt", page: 2 },
    { source: "doc3.txt", page: 3 },
  ];

  const testScores = [0.95, 0.87, 0.82];

  test("should format chunks with SIMPLE format", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
    });

    expect(result.context).toBeDefined();
    expect(result.chunksUsed).toBe(3);
    expect(result.totalLength).toBeGreaterThan(0);
    expect(result.context).toContain(testChunks[0]);
    expect(result.context).toContain(testChunks[1]);
    expect(result.context).toContain(testChunks[2]);
  });

  test("should format chunks with NUMBERED format", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      format: ContextFormat.NUMBERED,
    });

    expect(result.context).toContain("[1]");
    expect(result.context).toContain("[2]");
    expect(result.context).toContain("[3]");
    expect(result.context).toContain(testChunks[0]);
  });

  test("should format chunks with XML format", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      format: ContextFormat.XML,
    });

    expect(result.context).toContain("<chunk");
    expect(result.context).toContain("</chunk>");
    expect(result.context).toContain('id="1"');
    expect(result.context).toContain(testChunks[0]);
  });

  test("should format chunks with MARKDOWN format", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      format: ContextFormat.MARKDOWN,
    });

    expect(result.context).toContain("### Chunk");
    expect(result.context).toContain("### Chunk 1");
    expect(result.context).toContain("### Chunk 2");
    expect(result.context).toContain(testChunks[0]);
  });

  test("should format chunks with JSON format", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      format: ContextFormat.JSON,
    });

    // Should contain JSON objects
    expect(result.context).toContain('"index"');
    expect(result.context).toContain('"content"');
    expect(result.context).toContain(testChunks[0]);
  });

  test("should include metadata when includeMetadata is true", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      metadata: testMetadata,
      includeMetadata: true,
      format: ContextFormat.NUMBERED,
    });

    expect(result.context).toContain("doc1.txt");
    expect(result.context).toContain("page");
  });

  test("should include scores when provided and includeMetadata is true", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      metadata: testMetadata,
      scores: testScores,
      includeMetadata: true,
      format: ContextFormat.NUMBERED,
    });

    // NUMBERED format includes scores in the formatNumbered method when includeMetadata is true
    // The formatNumbered method uses formatMetadataInline which includes scores
    expect(result.context).toContain("score=");
    expect(result.context).toContain("0.95");
  });

  test("should respect maxLength constraint", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      maxLength: 100,
    });

    expect(result.totalLength).toBeLessThanOrEqual(100);
    expect(result.chunksUsed).toBeLessThanOrEqual(testChunks.length);
  });

  test("should use custom separator", async () => {
    const separator = "---";
    const result = await contextBuilder({
      chunks: testChunks,
      separator: separator,
    });

    // Should contain separator between chunks
    const separatorCount = (result.context.match(new RegExp(separator, "g")) || []).length;
    expect(separatorCount).toBeGreaterThan(0);
  });

  test("should handle empty chunks array", async () => {
    const result = await contextBuilder({
      chunks: [],
    });

    expect(result.context).toBe("");
    expect(result.chunksUsed).toBe(0);
    expect(result.totalLength).toBe(0);
  });

  test("should handle single chunk", async () => {
    const singleChunk = ["Only one chunk"];
    const result = await contextBuilder({
      chunks: singleChunk,
    });

    expect(result.context).toBe(singleChunk[0]);
    expect(result.chunksUsed).toBe(1);
    expect(result.totalLength).toBe(singleChunk[0].length);
  });

  test("should handle chunks with mismatched metadata length", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      metadata: [testMetadata[0]], // Only one metadata entry
      includeMetadata: true,
    });

    // Should handle gracefully, only include metadata where available
    expect(result.chunksUsed).toBe(3);
    expect(result.context).toBeDefined();
  });

  test("should handle chunks with mismatched scores length", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      scores: [testScores[0]], // Only one score
      includeMetadata: true,
    });

    expect(result.chunksUsed).toBe(3);
    expect(result.context).toBeDefined();
  });

  test("should truncate first chunk if maxLength is very small", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
      maxLength: 30,
    });

    expect(result.totalLength).toBeLessThanOrEqual(30);
    expect(result.context.length).toBeLessThanOrEqual(30);
    expect(result.chunksUsed).toBe(1);
    expect(result.context).toContain("...");
  });

  test("should use default separator when not specified", async () => {
    const result = await contextBuilder({
      chunks: testChunks,
    });

    // Default separator is "\n\n"
    expect(result.context).toContain("\n\n");
  });

  test("should escape XML special characters in XML format", async () => {
    const chunksWithSpecialChars = ['Text with <tag> & "quotes"'];
    const result = await contextBuilder({
      chunks: chunksWithSpecialChars,
      format: ContextFormat.XML,
    });

    // Should escape XML characters
    expect(result.context).not.toContain("<tag>");
    expect(result.context).toContain("&lt;tag&gt;");
    expect(result.context).toContain("&amp;");
    expect(result.context).toContain("&quot;quotes&quot;");
  });

  test("should format metadata correctly in different formats", async () => {
    // Test MARKDOWN format with metadata
    const markdownResult = await contextBuilder({
      chunks: testChunks,
      metadata: testMetadata,
      includeMetadata: true,
      format: ContextFormat.MARKDOWN,
    });

    expect(markdownResult.context).toContain("**Metadata:**");
    expect(markdownResult.context).toContain("- source:");

    // Test JSON format with metadata
    const jsonResult = await contextBuilder({
      chunks: testChunks,
      metadata: testMetadata,
      includeMetadata: true,
      format: ContextFormat.JSON,
    });

    expect(jsonResult.context).toContain('"metadata"');
  });

  test("should handle very long chunks", async () => {
    const longChunk = "A".repeat(10000);
    const result = await contextBuilder({
      chunks: [longChunk],
      maxLength: 5000,
    });

    expect(result.totalLength).toBeLessThanOrEqual(5000);
  });
});

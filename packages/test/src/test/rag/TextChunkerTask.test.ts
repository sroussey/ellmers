/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkingStrategy, textChunker } from "@workglow/ai";
import { describe, expect, test } from "vitest";
import { setLogger } from "@workglow/util";
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

describe("TextChunkerTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const testText =
    "This is the first sentence. This is the second sentence! This is the third sentence? " +
    "This is the fourth sentence. This is the fifth sentence.";

  test("should chunk text with FIXED strategy and emit ChunkRecord[]", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({
      text: testText,
      doc_id: "my-doc",
      chunkSize: 50,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.count).toBe(result.chunks.length);
    expect(result.text).toHaveLength(result.chunks.length);
    expect(result.doc_id).toBe("my-doc");

    result.chunks.forEach((chunk, idx) => {
      expect(chunk.chunkId).toBe(`my-doc:${idx}`);
      expect(chunk.doc_id).toBe("my-doc");
      expect(chunk.text).toBe(result.text[idx]);
      expect(chunk.nodePath).toEqual(["my-doc"]);
      expect(chunk.depth).toBe(chunk.nodePath.length);
    });
    reportTime("text-chunk: fixed", started);
    reportMem("text-chunk: fixed", startMem);
  });

  test("should omit doc_id from output when not provided and emit deterministic chunkIds", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const first = await textChunker({ text: testText, chunkSize: 50 });
    const second = await textChunker({ text: testText, chunkSize: 50 });

    expect(first.doc_id).toBeUndefined();
    expect(second.doc_id).toBeUndefined();
    expect(first.chunks.map((c) => c.chunkId)).toEqual(second.chunks.map((c) => c.chunkId));
    first.chunks.forEach((chunk) => {
      expect(chunk.doc_id).toBe("");
      expect(chunk.nodePath).toEqual([]);
      expect(chunk.depth).toBe(0);
      expect(chunk.chunkId).toMatch(/^chunk:\d+:\d+$/);
    });
    reportTime("text-chunk: no-doc-id", started);
    reportMem("text-chunk: no-doc-id", startMem);
  });

  test("should chunk with SENTENCE strategy", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({
      text: testText,
      doc_id: "d1",
      chunkSize: 80,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.SENTENCE,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    result.chunks.forEach((chunk) => {
      expect(chunk.text.length).toBeGreaterThan(0);
    });
    reportTime("text-chunk: sentence", started);
    reportMem("text-chunk: sentence", startMem);
  });

  test("should chunk with PARAGRAPH strategy", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const paragraphText =
      "First paragraph with multiple sentences. It has more content.\n\n" +
      "Second paragraph with different content. It also has sentences.\n\n" +
      "Third paragraph is here. With more text.";

    const result = await textChunker({
      text: paragraphText,
      doc_id: "d1",
      chunkSize: 100,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.PARAGRAPH,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    reportTime("text-chunk: paragraph", started);
    reportMem("text-chunk: paragraph", startMem);
  });

  test("should honour a provided doc_id", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({
      text: testText,
      doc_id: "my-doc",
      chunkSize: 50,
    });

    expect(result.doc_id).toBe("my-doc");
    result.chunks.forEach((chunk) => {
      expect(chunk.doc_id).toBe("my-doc");
    });
    reportTime("text-chunk: doc-id", started);
    reportMem("text-chunk: doc-id", startMem);
  });

  test("should handle default parameters", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({ text: testText });
    expect(result.chunks.length).toBeGreaterThan(0);
    reportTime("text-chunk: defaults", started);
    reportMem("text-chunk: defaults", startMem);
  });

  test("should handle chunkOverlap correctly", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const shortText = "A".repeat(100);
    const result = await textChunker({
      text: shortText,
      chunkSize: 30,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    expect(result.chunks.length).toBeGreaterThan(1);

    if (result.chunks.length > 1) {
      const firstChunkEnd = result.chunks[0].text.slice(-10);
      const secondChunkStart = result.chunks[1].text.slice(0, 10);
      expect(firstChunkEnd).toBe(secondChunkStart);
    }
    reportTime("text-chunk: overlap", started);
    reportMem("text-chunk: overlap", startMem);
  });

  test("should handle text shorter than chunkSize", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const shortText = "Short text";
    const result = await textChunker({ text: shortText, chunkSize: 100, chunkOverlap: 10 });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].text).toBe(shortText);
    reportTime("text-chunk: short-text", started);
    reportMem("text-chunk: short-text", startMem);
  });

  test("should handle empty text", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({ text: "", chunkSize: 50 });
    expect(result.chunks).toBeDefined();
    reportTime("text-chunk: empty", started);
    reportMem("text-chunk: empty", startMem);
  });

  test("should handle SEMANTIC strategy (aliased to sentence)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({
      text: testText,
      chunkSize: 80,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.SEMANTIC,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    reportTime("text-chunk: semantic", started);
    reportMem("text-chunk: semantic", startMem);
  });

  test("should handle very large chunkSize", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({ text: testText, chunkSize: 10000, chunkOverlap: 0 });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].text).toBe(testText);
    reportTime("text-chunk: large-size", started);
    reportMem("text-chunk: large-size", startMem);
  });

  test("should handle overlap equal to chunkSize (edge case)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({ text: testText, chunkSize: 50, chunkOverlap: 50 });
    expect(result.chunks.length).toBeGreaterThan(0);
    reportTime("text-chunk: overlap-equal", started);
    reportMem("text-chunk: overlap-equal", startMem);
  });

  test("should handle overlap greater than chunkSize (edge case)", async () => {
    const started = Date.now();
    const startMem = snapMem();
    const result = await textChunker({ text: testText, chunkSize: 30, chunkOverlap: 50 });
    expect(result.chunks.length).toBeGreaterThan(0);
    reportTime("text-chunk: overlap-exceeds", started);
    reportMem("text-chunk: overlap-exceeds", startMem);
  });
});

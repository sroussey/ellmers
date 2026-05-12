/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkRecord, DocumentNode } from "@workglow/knowledge-base";
import { Document, NodeKind } from "@workglow/knowledge-base";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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

let _started = 0;
let _startMem: MemSnapshot;
beforeEach(() => {
  _started = Date.now();
  _startMem = snapMem();
});
afterEach((ctx) => {
  reportTime(`document: ${ctx.task.name}`, _started);
  reportMem(`document: ${ctx.task.name}`, _startMem);
});

describe("Document", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const createTestDocumentNode = (): DocumentNode => ({
    nodeId: "root",
    kind: NodeKind.DOCUMENT,
    range: { startOffset: 0, endOffset: 100 },
    text: "Test document stuff",
    title: "Test document",
    children: [],
  });

  const createTestChunks = (): ChunkRecord[] => [
    {
      chunkId: "chunk1",
      doc_id: "doc1",
      text: "Test chunk",
      nodePath: ["root"],
      depth: 1,
    },
  ];

  test("setChunks and getChunks", () => {
    const doc = new Document(createTestDocumentNode(), { title: "Test" }, [], "doc1");

    doc.setChunks(createTestChunks());

    const chunks = doc.getChunks();
    expect(chunks).toBeDefined();
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Test chunk");
  });

  test("findChunksByNodeId", () => {
    const doc = new Document(createTestDocumentNode(), { title: "Test" }, [], "doc1");

    doc.setChunks(createTestChunks());

    const chunks = doc.findChunksByNodeId("root");
    expect(chunks).toBeDefined();
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Test chunk");
  });
});

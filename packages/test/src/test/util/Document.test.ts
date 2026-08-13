/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkRecord, DocumentNode } from "@workglow/knowledge-base";
import { Document, NodeKind } from "@workglow/knowledge-base";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, test } from "vitest";

describe("Document", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const createTestDocumentNode = (): DocumentNode => ({
    nodeId: "root",
    kind: NodeKind.DOCUMENT,
    range: { startOffset: 0, endOffset: 100 },
    text: "Test document",
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

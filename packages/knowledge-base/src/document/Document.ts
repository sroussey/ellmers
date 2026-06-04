/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkRecord } from "../chunk/ChunkSchema";
import type { DocumentMetadata, DocumentNode } from "./DocumentSchema";

/**
 * Hierarchical document: a single source-of-truth tree (`root`) plus the
 * flat list of chunks derived from it. Structure and vectors are persisted
 * separately by the {@link KnowledgeBase}.
 */
export class Document {
  public doc_id: string | undefined;
  public readonly metadata: DocumentMetadata;
  public readonly root: DocumentNode;
  private chunks: ChunkRecord[];

  constructor(
    root: DocumentNode,
    metadata: DocumentMetadata,
    chunks: ChunkRecord[] = [],
    doc_id?: string
  ) {
    this.doc_id = doc_id;
    this.root = root;
    this.metadata = metadata;
    this.chunks = chunks || [];
  }

  setChunks(chunks: ChunkRecord[]): void {
    this.chunks = chunks;
  }

  getChunks(): ChunkRecord[] {
    return this.chunks;
  }

  setDocId(doc_id: string): void {
    this.doc_id = doc_id;
  }

  findChunksByNodeId(nodeId: string): ChunkRecord[] {
    return this.chunks.filter((chunk) => chunk.nodePath.includes(nodeId));
  }

  toJSON(): {
    metadata: DocumentMetadata;
    root: DocumentNode;
    chunks: ChunkRecord[];
  } {
    return {
      metadata: this.metadata,
      root: this.root,
      chunks: this.chunks,
    };
  }

  static fromJSON(json: string, doc_id?: string): Document {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object") {
      throw new Error("Document.fromJSON: expected a JSON object");
    }
    if (!obj.root || typeof obj.root !== "object" || !obj.root.kind) {
      throw new Error("Document.fromJSON: missing or invalid 'root' node");
    }
    if (
      !obj.metadata ||
      typeof obj.metadata !== "object" ||
      typeof obj.metadata.title !== "string"
    ) {
      throw new Error("Document.fromJSON: missing or invalid 'metadata' (requires 'title' string)");
    }
    if (obj.chunks !== undefined && !Array.isArray(obj.chunks)) {
      throw new Error("Document.fromJSON: 'chunks' must be an array if present");
    }
    return new Document(obj.root, obj.metadata, obj.chunks, doc_id);
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, FromSchema, JsonSchema } from "@workglow/util/schema";
import { EntitySchema } from "../document/DocumentSchema";

/** Flat, JSON-schema description of a single chunk row. */
export const ChunkRecordSchema = () =>
  ({
    type: "object",
    properties: {
      chunkId: {
        type: "string",
        title: "Chunk ID",
        description: "Unique identifier for this chunk",
      },
      doc_id: {
        type: "string",
        title: "Document ID",
        description: "ID of the parent document",
      },
      text: {
        type: "string",
        title: "Text",
        description: "Text content of the chunk",
      },
      nodePath: {
        type: "array",
        items: { type: "string" },
        title: "Node Path",
        description: "Node IDs from root to leaf",
      },
      depth: {
        type: "integer",
        title: "Depth",
        description: "Depth in the document tree",
      },
      leafNodeId: {
        type: "string",
        title: "Leaf Node ID",
        description: "ID of the leaf node this chunk belongs to",
      },
      summary: {
        type: "string",
        title: "Summary",
        description: "Summary of the chunk content",
      },
      entities: {
        type: "array",
        items: EntitySchema,
        title: "Entities",
        description: "Named entities extracted from the chunk",
      },
      parentSummaries: {
        type: "array",
        items: { type: "string" },
        title: "Parent Summaries",
        description: "Summaries from ancestor nodes",
      },
      sectionTitles: {
        type: "array",
        items: { type: "string" },
        title: "Section Titles",
        description: "Titles of ancestor section nodes",
      },
      doc_title: {
        type: "string",
        title: "Document Title",
        description: "Title of the parent document",
      },
    },
    required: ["chunkId", "doc_id", "text", "nodePath", "depth"],
    additionalProperties: true,
  }) as const satisfies DataPortSchema;

export type ChunkRecord = FromSchema<ReturnType<typeof ChunkRecordSchema>>;

export const ChunkRecordArraySchema = {
  type: "array",
  items: ChunkRecordSchema(),
  title: "Chunk Records",
  description: "Array of chunk records",
} as const satisfies JsonSchema;

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

/**
 * Node kind discriminator for hierarchical document structure
 */
export const NodeKind = {
  DOCUMENT: "document",
  SECTION: "section",
  PARAGRAPH: "paragraph",
  SENTENCE: "sentence",
  TOPIC: "topic",
  TABLE: "table",
  LIST: "list",
  IMAGE: "image",
} as const;

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Schema for source range of a node (character offsets)
 */
export const NodeRangeSchema = {
  type: "object",
  properties: {
    startOffset: {
      type: "integer",
      title: "Start Offset",
      description: "Starting character offset",
    },
    endOffset: {
      type: "integer",
      title: "End Offset",
      description: "Ending character offset",
    },
  },
  required: ["startOffset", "endOffset"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type NodeRange = FromSchema<typeof NodeRangeSchema>;

/**
 * Schema for named entity extracted from text
 */
export const EntitySchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Entity text",
    },
    type: {
      type: "string",
      title: "Type",
      description: "Entity type (e.g., PERSON, ORG, LOC)",
    },
    score: {
      type: "number",
      title: "Score",
      description: "Confidence score",
    },
  },
  required: ["text", "type", "score"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type Entity = FromSchema<typeof EntitySchema>;

/**
 * Schema for enrichment data attached to a node
 */
export const NodeEnrichmentSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      title: "Summary",
      description: "Summary of the node content",
    },
    entities: {
      type: "array",
      items: EntitySchema,
      title: "Entities",
      description: "Named entities extracted from the node",
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      title: "Keywords",
      description: "Keywords associated with the node",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type NodeEnrichment = FromSchema<typeof NodeEnrichmentSchema>;

/**
 * Schema for base document node fields (used for runtime validation)
 * Note: Individual node types and DocumentNode union are defined as interfaces
 * below because FromSchema cannot properly infer recursive discriminated unions.
 */
export const DocumentNodeBaseSchema = {
  type: "object",
  properties: {
    nodeId: {
      type: "string",
      title: "Node ID",
      description: "Unique identifier for this node",
    },
    kind: {
      type: "string",
      enum: Object.values(NodeKind),
      title: "Kind",
      description: "Node type discriminator",
    },
    range: NodeRangeSchema,
    text: {
      type: "string",
      title: "Text",
      description: "Text content of the node",
    },
    enrichment: NodeEnrichmentSchema,
  },
  required: ["nodeId", "kind", "range", "text"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

/**
 * Schema for document node (generic, for runtime validation)
 * This is a simplified schema for task input/output validation.
 * The actual TypeScript types use a proper discriminated union.
 */
export const DocumentNodeSchema = {
  type: "object",
  title: "Document Node",
  description: "A node in the hierarchical document tree",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    level: {
      type: "integer",
      title: "Level",
      description: "Header level for section nodes",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Section title",
    },
    children: {
      type: "array",
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required],
  // Generic union approximation used to validate heterogeneous children. Each
  // node kind (section/table/list/image/...) carries kind-specific fields, so
  // extra properties are permitted here; the TypeScript discriminated union is
  // the precise contract.
  additionalProperties: true,
} as const satisfies DataPortSchema;

/**
 * Schema for paragraph node
 */
export const ParagraphNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.PARAGRAPH,
      title: "Kind",
      description: "Node type discriminator",
    },
  },
  required: [...DocumentNodeBaseSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for sentence node
 */
export const SentenceNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.SENTENCE,
      title: "Kind",
      description: "Node type discriminator",
    },
  },
  required: [...DocumentNodeBaseSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for section node
 */
export const SectionNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.SECTION,
      title: "Kind",
      description: "Node type discriminator",
    },
    level: {
      type: "integer",
      minimum: 1,
      maximum: 6,
      title: "Level",
      description: "Header level (1-6 for markdown)",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Section title",
    },
    children: {
      type: "array",
      items: DocumentNodeSchema,
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "level", "title", "children"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for topic node
 */
export const TopicNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.TOPIC,
      title: "Kind",
      description: "Node type discriminator",
    },
    children: {
      type: "array",
      items: DocumentNodeSchema,
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "children"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/** Schema for a single table cell. */
export const TableCellSchema = {
  type: "object",
  properties: {
    text: { type: "string", title: "Text", description: "Cell text" },
    colspan: { type: "integer", minimum: 1, title: "Colspan", description: "Columns spanned" },
    rowspan: { type: "integer", minimum: 1, title: "Rowspan", description: "Rows spanned" },
    isHeader: { type: "boolean", title: "Is Header", description: "Header cell" },
    numeric: { type: "number", title: "Numeric", description: "Parsed numeric value if any" },
  },
  required: ["text", "colspan", "rowspan", "isHeader"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/** Schema for table node. */
export const TableNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.TABLE,
      title: "Kind",
      description: "Node type discriminator",
    },
    caption: { type: "string", title: "Caption", description: "Table caption" },
    columnCount: {
      type: "integer",
      minimum: 0,
      title: "Column Count",
      description: "Columns after colspan expansion (0 = empty table)",
    },
    headerRows: {
      type: "array",
      items: { type: "array", items: TableCellSchema },
      title: "Header Rows",
      description: "Leading header rows",
    },
    rows: {
      type: "array",
      items: { type: "array", items: TableCellSchema },
      title: "Rows",
      description: "Body rows",
    },
    stitchedFrom: {
      type: "integer",
      minimum: 1,
      title: "Stitched From",
      description: "Page fragments merged (1 = none)",
    },
  },
  required: [
    ...DocumentNodeBaseSchema.required,
    "columnCount",
    "headerRows",
    "rows",
    "stitchedFrom",
  ],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/** Schema for list node. */
export const ListNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.LIST,
      title: "Kind",
      description: "Node type discriminator",
    },
    ordered: { type: "boolean", title: "Ordered", description: "Ordered vs unordered" },
    items: {
      type: "array",
      items: { type: "string" },
      title: "Items",
      description: "List item texts",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "ordered", "items"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/** Schema for image node. */
export const ImageNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.IMAGE,
      title: "Kind",
      description: "Node type discriminator",
    },
    src: { type: "string", title: "Src", description: "Image source href" },
    alt: { type: "string", title: "Alt", description: "Alt text" },
  },
  required: [...DocumentNodeBaseSchema.required, "src"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for document root node
 */
export const DocumentRootNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.DOCUMENT,
      title: "Kind",
      description: "Node type discriminator",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Document title",
    },
    children: {
      type: "array",
      items: DocumentNodeSchema,
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "title", "children"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

// =============================================================================
// Manually-defined interfaces for recursive discriminated union types
// These provide better TypeScript inference than FromSchema for recursive types
// =============================================================================

/**
 * Base document node fields
 */
interface DocumentNodeBase {
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly range: NodeRange;
  readonly text: string;
  readonly enrichment?: NodeEnrichment;
}

/**
 * Document root node
 */
export interface DocumentRootNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.DOCUMENT;
  readonly title: string;
  readonly children: DocumentNode[];
}

/**
 * Section node (from markdown headers or structural divisions)
 */
export interface SectionNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.SECTION;
  readonly level: number;
  readonly title: string;
  readonly children: DocumentNode[];
}

/**
 * Paragraph node
 */
export interface ParagraphNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.PARAGRAPH;
}

/**
 * Sentence node (optional fine-grained segmentation)
 */
export interface SentenceNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.SENTENCE;
}

/**
 * Topic segment node (from TopicSegmenter)
 */
export interface TopicNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.TOPIC;
  readonly children: DocumentNode[];
}

/** A single cell in a table node. */
export interface TableCell {
  readonly text: string;
  readonly colspan: number;
  readonly rowspan: number;
  readonly isHeader: boolean;
  readonly numeric: number | undefined;
}

/** Table node (leaf). Structured grid + GFM rendering in `text`. */
export interface TableNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.TABLE;
  readonly caption: string | undefined;
  readonly columnCount: number;
  readonly headerRows: TableCell[][];
  readonly rows: TableCell[][];
  readonly stitchedFrom: number;
}

/** List node (leaf). */
export interface ListNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.LIST;
  readonly ordered: boolean;
  readonly items: string[];
}

/** Image node (leaf). */
export interface ImageNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.IMAGE;
  readonly src: string;
  readonly alt: string | undefined;
}

/**
 * Discriminated union of all document node types
 */
export type DocumentNode =
  | DocumentRootNode
  | SectionNode
  | ParagraphNode
  | SentenceNode
  | TopicNode
  | TableNode
  | ListNode
  | ImageNode;

// =============================================================================
// Token Budget
// =============================================================================

/**
 * Schema for token budget configuration
 */
export const TokenBudgetSchema = {
  type: "object",
  properties: {
    maxTokensPerChunk: {
      type: "integer",
      title: "Max Tokens Per Chunk",
      description: "Maximum tokens allowed per chunk",
    },
    overlapTokens: {
      type: "integer",
      title: "Overlap Tokens",
      description: "Number of tokens to overlap between chunks",
    },
    reservedTokens: {
      type: "integer",
      title: "Reserved Tokens",
      description: "Tokens reserved for metadata or context",
    },
  },
  required: ["maxTokensPerChunk", "overlapTokens", "reservedTokens"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TokenBudget = FromSchema<typeof TokenBudgetSchema>;

// =============================================================================
// Document Metadata
// =============================================================================

/**
 * Schema for document metadata
 */
export const DocumentMetadataSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      title: "Title",
      description: "Document title",
    },
    sourceUri: {
      type: "string",
      title: "Source URI",
      description: "Original source URI of the document",
    },
    createdAt: {
      type: "string",
      title: "Created At",
      description: "ISO timestamp of creation",
    },
  },
  required: ["title"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type DocumentMetadata = FromSchema<typeof DocumentMetadataSchema>;

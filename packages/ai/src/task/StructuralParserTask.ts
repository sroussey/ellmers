/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DocumentRootNode } from "@workglow/knowledge-base";
import { StructuralParser } from "@workglow/knowledge-base";
import type { IExecuteContext, IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import { uuid4 } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text content to parse",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Document title",
    },
    format: {
      type: "string",
      enum: ["markdown", "text", "auto"],
      title: "Format",
      description: "Document format (auto-detects if not specified)",
      default: "auto",
    },
    sourceUri: {
      type: "string",
      title: "Source URI",
      description: "Source identifier for document ID generation",
    },
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "Pre-generated document ID (optional)",
    },
  },
  required: ["text", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "Generated or provided document ID",
    },
    documentTree: {
      type: "object",
      title: "Document Tree",
      description: "Parsed hierarchical document tree",
      additionalProperties: true,
    },
    nodeCount: {
      type: "number",
      title: "Node Count",
      description: "Total number of nodes in the tree",
    },
  },
  required: ["doc_id", "documentTree", "nodeCount"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StructuralParserTaskInput = {
  format?: "text" | "markdown" | "auto" | undefined;
  doc_id?: string | undefined;
  sourceUri?: string | undefined;
  title: string;
  text: string;
};
export type StructuralParserTaskOutput = Omit<
  { doc_id: string; documentTree: { [x: string]: unknown }; nodeCount: number },
  "documentTree"
> & { documentTree: DocumentRootNode };
export type StructuralParserTaskConfig = TaskConfig<StructuralParserTaskInput>;

/**
 * Task for parsing documents into hierarchical tree structure
 * Supports markdown and plain text with automatic format detection
 */
export class StructuralParserTask extends Task<
  StructuralParserTaskInput,
  StructuralParserTaskOutput,
  StructuralParserTaskConfig
> {
  public static override type = "StructuralParserTask";
  /** Pure-compute parsing task — no provider capability required. */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "Document";
  public static override title = "Structural Parser";
  public static override description = "Parse documents into hierarchical tree structure";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: StructuralParserTaskInput,
    _context: IExecuteContext
  ): Promise<StructuralParserTaskOutput> {
    const { text, title, format = "auto", sourceUri, doc_id: providedDocId } = input;

    // Use explicit doc_id when provided, otherwise derive a stable ID from sourceUri,
    // falling back to a generated UUID only when neither input is available.
    const doc_id = providedDocId || sourceUri || uuid4();

    // Parse based on format
    let documentTree: DocumentRootNode;
    if (format === "markdown") {
      documentTree = await StructuralParser.parseMarkdown(doc_id, text, title);
    } else if (format === "text") {
      documentTree = await StructuralParser.parsePlainText(doc_id, text, title);
    } else {
      // Auto-detect
      documentTree = await StructuralParser.parse(doc_id, text, title);
    }

    // Count nodes
    const nodeCount = this.countNodes(documentTree);

    return {
      doc_id,
      documentTree,
      nodeCount,
    };
  }

  private countNodes(node: any): number {
    let count = 1;
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        count += this.countNodes(child);
      }
    }
    return count;
  }
}

export const structuralParser = (
  input: StructuralParserTaskInput,
  config?: StructuralParserTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new StructuralParserTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    structuralParser: CreateWorkflow<
      StructuralParserTaskInput,
      StructuralParserTaskOutput,
      StructuralParserTaskConfig
    >;
  }
}

Workflow.prototype.structuralParser = CreateWorkflow(StructuralParserTask);

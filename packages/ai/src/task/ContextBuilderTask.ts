/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { estimateTokens } from "@workglow/knowledge-base";
import type {
  IExecuteContext,
  IExecutePreviewContext,
  IRunConfig,
  TaskConfig,
} from "@workglow/task-graph";
import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
import { CountTokensTask } from "./CountTokensTask";
import { TypeModel } from "./base/AiTaskSchemas";

export const ContextFormat = {
  SIMPLE: "simple",
  NUMBERED: "numbered",
  XML: "xml",
  MARKDOWN: "markdown",
  JSON: "json",
} as const;

export type ContextFormat = (typeof ContextFormat)[keyof typeof ContextFormat];

const modelSchema = TypeModel("model", {
  title: "Model",
  description: "Model to use for token counting (optional, falls back to estimation)",
});

const inputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Text Chunks",
      description: "Retrieved text chunks to format",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for each chunk",
      },
      title: "Metadata",
      description: "Metadata for each chunk (optional)",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Relevance scores for each chunk (optional)",
    },
    format: {
      type: "string",
      enum: Object.values(ContextFormat),
      title: "Format",
      description: "Format for the context output",
      default: ContextFormat.SIMPLE,
    },
    maxLength: {
      type: "number",
      title: "Max Length",
      description: "Maximum length of context in characters (0 = unlimited)",
      minimum: 0,
      default: 0,
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description:
        "Maximum number of tokens in context (0 = unlimited). Takes precedence over maxLength when set.",
      minimum: 0,
      default: 0,
    },
    includeMetadata: {
      type: "boolean",
      title: "Include Metadata",
      description: "Whether to include metadata in the context",
      default: false,
    },
    separator: {
      type: "string",
      title: "Separator",
      description: "Separator between chunks",
      default: "\n\n",
    },
    model: modelSchema,
  },
  required: ["chunks"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      type: "string",
      title: "Context",
      description: "Formatted context string for LLM",
    },
    chunksUsed: {
      type: "number",
      title: "Chunks Used",
      description: "Number of chunks included in context",
    },
    totalLength: {
      type: "number",
      title: "Total Length",
      description: "Total length of context in characters",
    },
    totalTokens: {
      type: "number",
      title: "Total Tokens",
      description: "Estimated token count of the context",
    },
  },
  required: ["context", "chunksUsed", "totalLength", "totalTokens"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ContextBuilderTaskInput = {
  maxLength?: number | undefined;
  format?: "simple" | "markdown" | "numbered" | "xml" | "json" | undefined;
  model?: string | ModelConfig | undefined;
  metadata?: { [x: string]: unknown }[] | undefined;
  maxTokens?: number | undefined;
  scores?: number[] | undefined;
  includeMetadata?: boolean | undefined;
  separator?: string | undefined;
  chunks: string[];
};
export type ContextBuilderTaskOutput = {
  context: string;
  chunksUsed: number;
  totalLength: number;
  totalTokens: number;
};
export type ContextBuilderTaskConfig = TaskConfig<ContextBuilderTaskInput>;

/**
 * Task for formatting retrieved chunks into context for LLM prompts.
 * Supports various formatting styles and length/token constraints.
 *
 * Token budgeting (for `maxTokens`) uses {@link estimateTokens} to approximate
 * the token count of the generated context. This is a character-based estimate
 * rather than an exact tokenizer tied to a specific model.
 */
export class ContextBuilderTask extends Task<
  ContextBuilderTaskInput,
  ContextBuilderTaskOutput,
  ContextBuilderTaskConfig
> {
  public static override type = "ContextBuilderTask";
  /** Pure-compute formatting task — no provider capability required. */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "RAG";
  public static override title = "Context Builder";
  public static override description = "Format retrieved chunks into context for LLM prompts";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: ContextBuilderTaskInput,
    context: IExecuteContext
  ): Promise<ContextBuilderTaskOutput> {
    // Preview and full-run produce identical output; share implementation.
    return this.executePreview(input, context);
  }

  override async executePreview(
    input: ContextBuilderTaskInput,
    context: IExecutePreviewContext
  ): Promise<ContextBuilderTaskOutput> {
    const {
      chunks,
      metadata = [],
      scores = [],
      format = ContextFormat.SIMPLE,
      maxLength = 0,
      maxTokens = 0,
      includeMetadata = false,
      separator = "\n\n",
    } = input;

    let countFn: (text: string) => Promise<number> = async (text: string) => estimateTokens(text);
    if (input.model) {
      const countTask = context.own(new CountTokensTask({ defaults: { model: input.model } }));
      countFn = async (text: string): Promise<number> => {
        try {
          const result = await countTask.run({ text });
          return result.count as number;
        } catch (_err) {
          // Fall back to local token estimation if CountTokensTask is unavailable or fails.
          return estimateTokens(text);
        }
      };
    }

    const useTokenBudget = maxTokens > 0;

    let ctx = "";
    let chunksUsed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const meta = metadata[i];
      const score = scores[i];

      let formattedChunk = this.formatChunk(chunk, meta, score, i, format, includeMetadata);
      const prefix = chunksUsed > 0 ? separator : "";
      const candidate = ctx + prefix + formattedChunk;

      if (useTokenBudget) {
        if ((await countFn(candidate)) > maxTokens) {
          if (chunksUsed === 0) {
            let truncated = formattedChunk;
            while (truncated.length > 10 && (await countFn(truncated)) > maxTokens) {
              truncated = truncated.substring(0, Math.floor(truncated.length * 0.9));
            }
            if (truncated.length > 10) {
              ctx = truncated.substring(0, truncated.length - 3) + "...";
              chunksUsed++;
            }
          }
          break;
        }
      } else if (maxLength > 0) {
        if (candidate.length > maxLength) {
          if (chunksUsed === 0) {
            const available = maxLength - ctx.length;
            if (available > 10) {
              formattedChunk = formattedChunk.substring(0, available - 3) + "...";
              ctx += formattedChunk;
              chunksUsed++;
            }
          }
          break;
        }
      }

      ctx = candidate;
      chunksUsed++;
    }

    const totalTokens = await countFn(ctx);

    return {
      context: ctx,
      chunksUsed,
      totalLength: ctx.length,
      totalTokens,
    };
  }

  private formatChunk(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    format: ContextFormat,
    includeMetadata: boolean
  ): string {
    switch (format) {
      case ContextFormat.NUMBERED:
        return this.formatNumbered(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.XML:
        return this.formatXML(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.MARKDOWN:
        return this.formatMarkdown(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.JSON:
        return this.formatJSON(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.SIMPLE:
      default:
        return chunk;
    }
  }

  private formatNumbered(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    let result = `[${index + 1}] ${chunk}`;
    if (includeMetadata && metadata) {
      const metaStr = this.formatMetadataInline(metadata, score);
      if (metaStr) {
        result += ` ${metaStr}`;
      }
    }
    return result;
  }

  private formatXML(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    let result = `<chunk id="${index + 1}">`;
    if (includeMetadata && (metadata || score !== undefined)) {
      result += "\n  <metadata>";
      if (score !== undefined) {
        result += `\n    <score>${score.toFixed(4)}</score>`;
      }
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          result += `\n    <${key}>${this.escapeXML(String(value))}</${key}>`;
        }
      }
      result += "\n  </metadata>";
      result += `\n  <content>${this.escapeXML(chunk)}</content>`;
      result += "\n</chunk>";
    } else {
      result += `${this.escapeXML(chunk)}</chunk>`;
    }
    return result;
  }

  private formatMarkdown(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    let result = `### Chunk ${index + 1}\n\n`;
    if (includeMetadata && (metadata || score !== undefined)) {
      result += "**Metadata:**\n";
      if (score !== undefined) {
        result += `- Score: ${score.toFixed(4)}\n`;
      }
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          result += `- ${key}: ${value}\n`;
        }
      }
      result += "\n";
    }
    result += chunk;
    return result;
  }

  private formatJSON(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    const obj: any = {
      index: index + 1,
      content: chunk,
    };
    if (includeMetadata) {
      if (score !== undefined) {
        obj.score = score;
      }
      if (metadata) {
        obj.metadata = metadata;
      }
    }
    return JSON.stringify(obj);
  }

  private formatMetadataInline(metadata: any, score: number | undefined): string {
    const parts: string[] = [];
    if (score !== undefined) {
      parts.push(`score=${score.toFixed(4)}`);
    }
    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        parts.push(`${key}=${value}`);
      }
    }
    return parts.length > 0 ? `(${parts.join(", ")})` : "";
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

export const contextBuilder = (
  input: ContextBuilderTaskInput,
  config?: ContextBuilderTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new ContextBuilderTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    contextBuilder: CreateWorkflow<
      ContextBuilderTaskInput,
      ContextBuilderTaskOutput,
      ContextBuilderTaskConfig
    >;
  }
}

Workflow.prototype.contextBuilder = CreateWorkflow(ContextBuilderTask);

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Task, Workflow } from "@workglow/task-graph";

import type { IExecuteContext, IRunConfig, TaskConfig } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";

export const SegmentationMethod = {
  HEURISTIC: "heuristic",
  EMBEDDING_SIMILARITY: "embedding-similarity",
  HYBRID: "hybrid",
} as const;

export type SegmentationMethod = (typeof SegmentationMethod)[keyof typeof SegmentationMethod];

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to segment into topics",
    },
    method: {
      type: "string",
      enum: Object.values(SegmentationMethod),
      title: "Segmentation Method",
      description: "Method to use for topic segmentation",
      default: SegmentationMethod.HEURISTIC,
    },
    minSegmentSize: {
      type: "number",
      title: "Min Segment Size",
      description: "Minimum segment size in characters",
      minimum: 50,
      default: 100,
    },
    maxSegmentSize: {
      type: "number",
      title: "Max Segment Size",
      description: "Maximum segment size in characters",
      minimum: 100,
      default: 2000,
    },
    similarityThreshold: {
      type: "number",
      title: "Similarity Threshold",
      description: "Threshold for embedding similarity (0-1, lower = more splits)",
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          startOffset: { type: "number" },
          endOffset: { type: "number" },
        },
        required: ["text", "startOffset", "endOffset"],
        additionalProperties: false,
      },
      title: "Segments",
      description: "Detected topic segments",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of segments detected",
    },
  },
  required: ["segments", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TopicSegmenterTaskInput = {
  method?: "hybrid" | "heuristic" | "embedding-similarity" | undefined;
  minSegmentSize?: number | undefined;
  maxSegmentSize?: number | undefined;
  similarityThreshold?: number | undefined;
  text: string;
};
export type TopicSegmenterTaskOutput = {
  count: number;
  segments: { text: string; startOffset: number; endOffset: number }[];
};
export type TopicSegmenterTaskConfig = TaskConfig<TopicSegmenterTaskInput>;

/**
 * Task for segmenting text into topic-based sections
 * Uses hybrid approach: heuristics + optional embedding similarity
 */
export class TopicSegmenterTask extends Task<
  TopicSegmenterTaskInput,
  TopicSegmenterTaskOutput,
  TopicSegmenterTaskConfig
> {
  public static override type = "TopicSegmenterTask";
  /** Pure-compute segmentation task — no provider capability required. */
  public static readonly requires: readonly Capability[] = [] as const satisfies Capability[];
  public static override category = "Document";
  public static override title = "Topic Segmenter";
  public static override description =
    "Segment text into topic-based sections using hybrid approach";
  public static override cacheable = true;
  private static readonly EMBEDDING_DIMENSIONS = 256;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: TopicSegmenterTaskInput,
    context: IExecuteContext
  ): Promise<TopicSegmenterTaskOutput> {
    const {
      text,
      method = SegmentationMethod.HEURISTIC,
      minSegmentSize = 100,
      maxSegmentSize = 2000,
      similarityThreshold = 0.5,
    } = input;

    let segments: Array<{ text: string; startOffset: number; endOffset: number }>;

    switch (method) {
      case SegmentationMethod.EMBEDDING_SIMILARITY:
        segments = this.embeddingSegmentation(
          text,
          minSegmentSize,
          maxSegmentSize,
          similarityThreshold
        );
        break;
      case SegmentationMethod.HYBRID:
        // Start with heuristic, optionally refine with embeddings
        segments = this.heuristicSegmentation(text, minSegmentSize, maxSegmentSize);
        // TODO: Add embedding refinement step
        break;
      case SegmentationMethod.HEURISTIC:
      default:
        segments = this.heuristicSegmentation(text, minSegmentSize, maxSegmentSize);
        break;
    }

    return {
      segments,
      count: segments.length,
    };
  }

  private embeddingSegmentation(
    text: string,
    minSegmentSize: number,
    maxSegmentSize: number,
    similarityThreshold: number
  ): Array<{ text: string; startOffset: number; endOffset: number }> {
    const paragraphs = this.splitIntoParagraphs(text);
    if (paragraphs.length === 0) {
      return [];
    }

    const embeddings = paragraphs.map((p) =>
      this.embedParagraph(p.text, TopicSegmenterTask.EMBEDDING_DIMENSIONS)
    );

    const segments: Array<{ text: string; startOffset: number; endOffset: number }> = [];
    let currentSegmentParagraphs: Array<{ text: string; offset: number }> = [];
    let currentSegmentSize = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const paragraphSize = paragraph.text.length;
      const exceedsMax =
        currentSegmentSize + paragraphSize > maxSegmentSize && currentSegmentSize >= minSegmentSize;

      let shouldSplit = false;
      if (i > 0 && currentSegmentSize >= minSegmentSize) {
        const prev = embeddings[i - 1];
        const curr = embeddings[i];
        const similarity = this.cosineSimilarityWithNorms(
          prev.vector,
          prev.norm,
          curr.vector,
          curr.norm
        );
        shouldSplit = similarity < similarityThreshold;
      }

      if ((exceedsMax || shouldSplit) && currentSegmentParagraphs.length > 0) {
        segments.push(this.createSegment(currentSegmentParagraphs));
        currentSegmentParagraphs = [];
        currentSegmentSize = 0;
      }

      currentSegmentParagraphs.push(paragraph);
      currentSegmentSize += paragraphSize;
    }

    if (currentSegmentParagraphs.length > 0) {
      segments.push(this.createSegment(currentSegmentParagraphs));
    }

    return this.mergeSmallSegments(segments, minSegmentSize);
  }

  private heuristicSegmentation(
    text: string,
    minSegmentSize: number,
    maxSegmentSize: number
  ): Array<{ text: string; startOffset: number; endOffset: number }> {
    const segments: Array<{ text: string; startOffset: number; endOffset: number }> = [];

    // Split by double newlines (paragraph breaks)
    const paragraphs = this.splitIntoParagraphs(text);

    let currentSegmentParagraphs: Array<{ text: string; offset: number }> = [];
    let currentSegmentSize = 0;

    for (const paragraph of paragraphs) {
      const paragraphSize = paragraph.text.length;

      // Check if adding this paragraph would exceed max size
      if (
        currentSegmentSize + paragraphSize > maxSegmentSize &&
        currentSegmentSize >= minSegmentSize
      ) {
        // Flush current segment
        if (currentSegmentParagraphs.length > 0) {
          const segment = this.createSegment(currentSegmentParagraphs);
          segments.push(segment);
          currentSegmentParagraphs = [];
          currentSegmentSize = 0;
        }
      }

      // Check for transition markers
      const hasTransition = this.hasTransitionMarker(paragraph.text);
      if (
        hasTransition &&
        currentSegmentSize >= minSegmentSize &&
        currentSegmentParagraphs.length > 0
      ) {
        // Flush current segment before transition
        const segment = this.createSegment(currentSegmentParagraphs);
        segments.push(segment);
        currentSegmentParagraphs = [];
        currentSegmentSize = 0;
      }

      currentSegmentParagraphs.push(paragraph);
      currentSegmentSize += paragraphSize;
    }

    // Flush remaining segment
    if (currentSegmentParagraphs.length > 0) {
      const segment = this.createSegment(currentSegmentParagraphs);
      segments.push(segment);
    }

    // Merge small segments
    return this.mergeSmallSegments(segments, minSegmentSize);
  }

  /**
   * Hashed token embedding for fast similarity checks.
   */
  private embedParagraph(text: string, dimensions: number): { vector: Float32Array; norm: number } {
    const vector = new Float32Array(dimensions);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g);
    if (!tokens) {
      return { vector, norm: 0 };
    }

    for (const token of tokens) {
      let hash = 2166136261;
      for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const index = (hash >>> 0) % dimensions;
      vector[index] += 1;
    }

    let sumSquares = 0;
    for (let i = 0; i < vector.length; i++) {
      const value = vector[i];
      sumSquares += value * value;
    }

    return { vector, norm: sumSquares > 0 ? Math.sqrt(sumSquares) : 0 };
  }

  private cosineSimilarityWithNorms(
    a: Float32Array,
    aNorm: number,
    b: Float32Array,
    bNorm: number
  ): number {
    if (aNorm === 0 || bNorm === 0) {
      return 0;
    }

    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }

    return dot / (aNorm * bNorm);
  }

  private splitIntoParagraphs(text: string): Array<{ text: string; offset: number }> {
    const paragraphs: Array<{ text: string; offset: number }> = [];
    const splits = text.split(/\n\s*\n/);

    let currentOffset = 0;
    for (const split of splits) {
      const trimmed = split.trim();
      if (trimmed.length > 0) {
        const offset = text.indexOf(trimmed, currentOffset);
        paragraphs.push({ text: trimmed, offset });
        currentOffset = offset + trimmed.length;
      }
    }

    return paragraphs;
  }

  private hasTransitionMarker(text: string): boolean {
    const transitionMarkers = [
      /^(however|therefore|thus|consequently|in conclusion|in summary|furthermore|moreover|additionally|meanwhile|nevertheless|on the other hand)/i,
      /^(first|second|third|finally|lastly)/i,
      /^\d+\./, // Numbered list
    ];

    return transitionMarkers.some((pattern) => pattern.test(text));
  }

  private createSegment(paragraphs: Array<{ text: string; offset: number }>): {
    text: string;
    startOffset: number;
    endOffset: number;
  } {
    const text = paragraphs.map((p) => p.text).join("\n\n");
    const startOffset = paragraphs[0].offset;
    const endOffset =
      paragraphs[paragraphs.length - 1].offset + paragraphs[paragraphs.length - 1].text.length;

    return { text, startOffset, endOffset };
  }

  private mergeSmallSegments(
    segments: Array<{ text: string; startOffset: number; endOffset: number }>,
    minSegmentSize: number
  ): Array<{ text: string; startOffset: number; endOffset: number }> {
    if (segments.length <= 1) {
      return segments;
    }

    const merged: Array<{ text: string; startOffset: number; endOffset: number }> = [];
    let i = 0;

    while (i < segments.length) {
      const current = segments[i];

      if (current.text.length < minSegmentSize && i + 1 < segments.length) {
        // Merge with next
        const next = segments[i + 1];
        const mergedSegment = {
          text: current.text + "\n\n" + next.text,
          startOffset: current.startOffset,
          endOffset: next.endOffset,
        };
        merged.push(mergedSegment);
        i += 2;
      } else if (current.text.length < minSegmentSize && merged.length > 0) {
        // Merge with previous
        const previous = merged[merged.length - 1];
        merged[merged.length - 1] = {
          text: previous.text + "\n\n" + current.text,
          startOffset: previous.startOffset,
          endOffset: current.endOffset,
        };
        i++;
      } else {
        merged.push(current);
        i++;
      }
    }

    return merged;
  }
}

export const topicSegmenter = (
  input: TopicSegmenterTaskInput,
  config?: TopicSegmenterTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TopicSegmenterTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    topicSegmenter: CreateWorkflow<
      TopicSegmenterTaskInput,
      TopicSegmenterTaskOutput,
      TopicSegmenterTaskConfig
    >;
  }
}

Workflow.prototype.topicSegmenter = CreateWorkflow(TopicSegmenterTask);

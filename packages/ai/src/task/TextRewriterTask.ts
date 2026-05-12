/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, IRunConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const modelSchema = TypeModel("model:TextRewriterTask");

export const TextRewriterInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to rewrite",
    },
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to direct the rewriting",
    },
    model: modelSchema,
  },
  required: ["text", "prompt", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextRewriterOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The rewritten text",
      "x-stream": "append",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextRewriterTaskInput = FromSchema<typeof TextRewriterInputSchema>;
export type TextRewriterTaskOutput = FromSchema<typeof TextRewriterOutputSchema>;
export type TextRewriterTaskConfig = TaskConfig<TextRewriterTaskInput>;

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 */
export class TextRewriterTask extends StreamingAiTask<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextRewriterTaskConfig
> {
  public static override type = "TextRewriterTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires: readonly Capability[] = [
    "text.rewriter",
  ] as const satisfies readonly Capability[];
  protected static override readonly streamingPhaseLabel = "Rewriting";
  public static override category = "AI Text";
  public static override title = "Text Rewriter";
  public static override description =
    "Rewrites text according to a given prompt using language models";
  public static override inputSchema(): DataPortSchema {
    return TextRewriterInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextRewriterOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run text rewriter tasks.
 * Creates and executes a TextRewriterCompoundTask with the provided input.
 * @param input The input parameters for text rewriting (text, prompt, and model)
 * @returns Promise resolving to the rewritten text output(s)
 */
export const textRewriter = (
  input: TextRewriterTaskInput,
  config?: TextRewriterTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextRewriterTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textRewriter: CreateWorkflow<
      TextRewriterTaskInput,
      TextRewriterTaskOutput,
      TextRewriterTaskConfig
    >;
  }
}

Workflow.prototype.textRewriter = CreateWorkflow(TextRewriterTask);

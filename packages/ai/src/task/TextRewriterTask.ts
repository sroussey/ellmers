/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { ModelConfig } from "../model/ModelSchema";
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

export type TextRewriterTaskInput = { model: string | ModelConfig; text: string; prompt: string };
export type TextRewriterTaskOutput = { text: string };
export type TextRewriterTaskConfig = TaskConfig<TextRewriterTaskInput>;

export class TextRewriterTask extends StreamingAiTask<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextRewriterTaskConfig
> {
  public static override type = "TextRewriterTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires = ["text.rewriter"] as const satisfies Capability[];
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

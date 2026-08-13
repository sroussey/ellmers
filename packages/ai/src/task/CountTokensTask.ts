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
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

export const CountTokensInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to count tokens for",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const CountTokensOutputSchema = {
  type: "object",
  properties: {
    count: {
      type: "number",
      title: "Token Count",
      description: "The number of tokens in the text",
    },
  },
  required: ["count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type CountTokensTaskInput = { model: string | ModelConfig; text: string };
export type CountTokensTaskOutput = { count: number };
export type CountTokensTaskConfig = TaskConfig<CountTokensTaskInput>;

/**
 * A task that counts the number of tokens in a text string using a specified model's tokenizer.
 * Token counts are model-specific and are useful for managing context window limits and
 * budgeting token usage in RAG pipelines.
 *
 * @extends AiTask
 */
export class CountTokensTask extends AiTask<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  CountTokensTaskConfig
> {
  public static override type = "CountTokensTask";
  /** Capability required of the model; gated in {@link AiTask.execute}. */
  public static override readonly requires = ["model.count-tokens"] as const satisfies Capability[];
  public static override category = "AI Text";
  public static override title = "Count Tokens";
  public static override description =
    "Counts the number of tokens in a text string using the model's tokenizer";
  public static override cacheable = true;
  public static override inputSchema(): DataPortSchema {
    return CountTokensInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return CountTokensOutputSchema as DataPortSchema;
  }
}

export const countTokens = async (
  input: CountTokensTaskInput,
  config?: CountTokensTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new CountTokensTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    countTokens: CreateWorkflow<CountTokensTaskInput, CountTokensTaskOutput, CountTokensTaskConfig>;
  }
}

Workflow.prototype.countTokens = CreateWorkflow(CountTokensTask);

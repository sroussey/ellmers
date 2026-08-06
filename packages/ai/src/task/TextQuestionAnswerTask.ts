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

const contextSchema = {
  type: "string",
  title: "Context",
  description: "The context of the question",
} as const;

const questionSchema = {
  type: "string",
  title: "Question",
  description: "The question to answer",
} as const;

const textSchema = {
  type: "string",
  title: "Text",
  description: "The generated text",
  "x-stream": "append",
} as const;

const modelSchema = TypeModel("model:TextQuestionAnswerTask");

export const TextQuestionAnswerInputSchema = {
  type: "object",
  properties: {
    context: contextSchema,
    question: questionSchema,
    model: modelSchema,
  },
  required: ["context", "question", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextQuestionAnswerOutputSchema = {
  type: "object",
  properties: {
    text: textSchema,
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextQuestionAnswerTaskInput = {
  model: string | ModelConfig;
  context: string;
  question: string;
};
export type TextQuestionAnswerTaskOutput = { text: string };
export type TextQuestionAnswerTaskConfig = TaskConfig<TextQuestionAnswerTaskInput>;

export class TextQuestionAnswerTask extends StreamingAiTask<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  TextQuestionAnswerTaskConfig
> {
  public static override type = "TextQuestionAnswerTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires = [
    "text.question-answering",
  ] as const satisfies Capability[];
  protected static override readonly streamingPhaseLabel = "Answering";
  public static override category = "AI Text";
  public static override title = "Text Question Answer";
  public static override description =
    "Answers questions based on provided context using language models";
  public static override inputSchema(): DataPortSchema {
    return TextQuestionAnswerInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return TextQuestionAnswerOutputSchema as DataPortSchema;
  }
}

export const textQuestionAnswer = (
  input: TextQuestionAnswerTaskInput,
  config?: TextQuestionAnswerTaskConfig,
  runConfig?: Partial<IRunConfig>
) => {
  return new TextQuestionAnswerTask(config).run(input, runConfig);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textQuestionAnswer: CreateWorkflow<
      TextQuestionAnswerTaskInput,
      TextQuestionAnswerTaskOutput,
      TextQuestionAnswerTaskConfig
    >;
  }
}

Workflow.prototype.textQuestionAnswer = CreateWorkflow(TextQuestionAnswerTask);

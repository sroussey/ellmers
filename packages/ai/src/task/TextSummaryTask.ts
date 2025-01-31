//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
  TaskRegistry,
  ConvertAllToArrays,
  ConvertSomeToOptionalArray,
  arrayTaskFactory,
  JobQueueTaskConfig,
} from "ellmers-core";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";

export type TextSummaryTaskInput = {
  text: string;
  model: string;
};
export type summarization_model = string;
export type TextSummaryTaskOutput = {
  text: summarization_model;
};

/**
 * This summarizes a piece of text
 */

export class TextSummaryTask extends JobQueueLlmTask {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "summarization_model",
    },
  ] as const;
  public static outputs = [{ id: "text", name: "Text", valueType: "text" }] as const;
  constructor(config: JobQueueTaskConfig & { input?: TextSummaryTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextSummaryTaskInput;
  declare runOutputData: TextSummaryTaskOutput;
  declare defaults: Partial<TextSummaryTaskInput>;
  static readonly type = "TextSummaryTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextSummaryTask);

type TextSummaryCompoundTaskOutput = ConvertAllToArrays<TextSummaryTaskOutput>;

type TextSummaryCompoundTaskInput = ConvertSomeToOptionalArray<
  TextSummaryTaskInput,
  "model" | "text"
>;
export const TextSummaryCompoundTask = arrayTaskFactory<
  TextSummaryCompoundTaskInput,
  TextSummaryCompoundTaskOutput,
  TextSummaryTaskOutput
>(TextSummaryTask, ["model", "text"]);

export const TextSummary = (input: TextSummaryCompoundTaskInput) => {
  return new TextSummaryCompoundTask({ input }).run();
};

declare module "ellmers-core" {
  interface TaskGraphBuilder {
    TextSummary: TaskGraphBuilderHelper<TextSummaryCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextSummary = TaskGraphBuilderHelper(TextSummaryCompoundTask);

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ConvertAllToArrays,
  ConvertOneToArray,
  ConvertOneToOptionalArrays,
  arrayTaskFactory,
} from "./base/ArrayTask";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";
import { JobQueueTaskConfig } from "./base/JobQueueTask";

export type TextSummaryTaskInput = CreateMappedType<typeof TextSummaryTask.inputs>;
export type TextSummaryTaskOutput = CreateMappedType<typeof TextSummaryTask.outputs>;

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
      valueType: "text_summarization_model",
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

type TextSummaryMultiTaskOutput = ConvertAllToArrays<TextSummaryTaskOutput>;

type TextSummaryMultiModelTaskInput = ConvertOneToArray<TextSummaryTaskInput, "model">;
export const TextSummaryMultiModelTask = arrayTaskFactory<
  TextSummaryMultiModelTaskInput,
  TextSummaryMultiTaskOutput
>(TextSummaryTask, "model");

type TextSummaryMultiTextTaskInput = ConvertOneToArray<TextSummaryTaskInput, "text">;
export const TextSummaryMultiTextTask = arrayTaskFactory<
  TextSummaryMultiTextTaskInput,
  TextSummaryMultiTaskOutput
>(TextSummaryTask, "text");

type TextSummaryMultiTextMultiModelTaskInput = ConvertOneToArray<
  TextSummaryMultiModelTaskInput,
  "text"
>;
export const TextSummaryMultiTextMultiModelTask = arrayTaskFactory<
  TextSummaryMultiTextMultiModelTaskInput,
  TextSummaryMultiTaskOutput
>(TextSummaryMultiModelTask, "text", "TextSummaryMultiTextMultiModelTask");

export const TextSummary = (
  input: ConvertOneToOptionalArrays<
    ConvertOneToOptionalArrays<TextSummaryTaskInput, "model">,
    "text"
  >
) => {
  if (Array.isArray(input.model) && Array.isArray(input.text)) {
    return new TextSummaryMultiTextMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.model)) {
    return new TextSummaryMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.text)) {
    return new TextSummaryMultiTextTask().addInputData(input).run();
  } else {
    return new TextSummaryTask().addInputData(input).run();
  }
};

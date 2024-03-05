//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ConvertAllToArrays, ConvertToArrays, arrayTaskFactory } from "./base/ArrayTask";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";
import { ModelFactory } from "./base/ModelFactory";

export type TextSummaryTaskInput = CreateMappedType<typeof TextSummaryTask.inputs>;
export type TextSummaryTaskOutput = CreateMappedType<typeof TextSummaryTask.outputs>;

/**
 * This summarizes a piece of text
 */

export class TextSummaryTask extends ModelFactory {
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

  declare runInputData: TextSummaryTaskInput;
  declare runOutputData: TextSummaryTaskOutput;
  declare defaults: Partial<TextSummaryTaskInput>;
  static readonly type = "TextSummaryTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextSummaryTask);

export const TextSummaryMultiModelTask = arrayTaskFactory<
  ConvertToArrays<TextSummaryTaskInput, "model">,
  ConvertAllToArrays<TextSummaryTaskOutput>
>(TextSummaryTask, "model");

export const TextSummaryMultiTextTask = arrayTaskFactory<
  ConvertToArrays<TextSummaryTaskInput, "text">,
  ConvertAllToArrays<TextSummaryTaskOutput>
>(TextSummaryTask, "text");

export const TextSummaryMultiTextModelTask = arrayTaskFactory<
  ConvertToArrays<ConvertToArrays<TextSummaryTaskInput, "model">, "text">,
  ConvertAllToArrays<TextSummaryTaskOutput>
>(TextSummaryMultiModelTask, "text", "TextSummaryMultiTextModelTask");

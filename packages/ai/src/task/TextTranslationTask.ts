//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ConvertAllToArrays, ConvertSomeToOptionalArray, arrayTaskFactory } from "ellmers-core";
import { CreateMappedType } from "ellmers-core";
import { TaskRegistry } from "ellmers-core";
import { JobQueueTaskConfig } from "ellmers-core";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "ellmers-core";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";

export type TextTranslationTaskInput = CreateMappedType<typeof TextTranslationTask.inputs>;
export type TextTranslationTaskOutput = CreateMappedType<typeof TextTranslationTask.outputs>;

/**
 * This generates text from a prompt
 */
export class TextTranslationTask extends JobQueueLlmTask {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_translation_model",
    },
    {
      id: "source",
      name: "Input Language",
      valueType: "language",
    },
    {
      id: "target",
      name: "Output Language",
      valueType: "language",
    },
  ] as const;
  public static outputs = [
    { id: "text", name: "Text", valueType: "text" },
    {
      id: "target",
      name: "Output Language",
      valueType: "language",
    },
  ] as const;
  constructor(config: JobQueueTaskConfig & { input?: TextTranslationTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextTranslationTaskInput;
  declare runOutputData: TextTranslationTaskOutput;
  declare defaults: Partial<TextTranslationTaskInput>;
  static readonly type = "TextTranslationTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextTranslationTask);

type TextTranslationCompoundOutput = ConvertAllToArrays<TextTranslationTaskOutput>;

type TextTranslationCompoundTaskInput = ConvertSomeToOptionalArray<
  TextTranslationTaskInput,
  "model" | "text"
>;
export const TextTranslationCompoundTask = arrayTaskFactory<
  TextTranslationCompoundTaskInput,
  TextTranslationCompoundOutput
>(TextTranslationTask, ["model", "text"]);

export const TextTranslation = (input: TextTranslationCompoundTaskInput) => {
  return new TextTranslationCompoundTask({ input }).run();
};

declare module "ellmers-core" {
  interface TaskGraphBuilder {
    TextTranslation: TaskGraphBuilderHelper<TextTranslationCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextTranslation = TaskGraphBuilderHelper(TextTranslationCompoundTask);

// console.log("TextTranslationTask.ts", TextTranslationCompoundTask);

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

export type TextQuestionAnswerTaskInput = CreateMappedType<typeof TextQuestionAnswerTask.inputs>;
export type TextQuestionAnswerTaskOutput = CreateMappedType<typeof TextQuestionAnswerTask.outputs>;

/**
 * This is a special case of text generation that takes a context and a question
 */
export class TextQuestionAnswerTask extends JobQueueLlmTask {
  public static inputs = [
    {
      id: "context",
      name: "Context",
      valueType: "text",
    },
    {
      id: "question",
      name: "Question",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_question_answering_model",
    },
  ] as const;
  public static outputs = [{ id: "answer", name: "Answer", valueType: "text" }] as const;
  constructor(config: JobQueueTaskConfig & { input?: TextQuestionAnswerTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextQuestionAnswerTaskInput;
  declare runOutputData: TextQuestionAnswerTaskOutput;
  declare defaults: Partial<TextQuestionAnswerTaskInput>;
  static readonly type = "TextQuestionAnswerTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextQuestionAnswerTask);

type TextQuestionAnswerMultiTaskOutput = ConvertAllToArrays<TextQuestionAnswerTaskOutput>;

type TextQuestionAnswerMultiModelTaskInput = ConvertOneToArray<
  TextQuestionAnswerTaskInput,
  "model"
>;
export const TextQuestionAnswerMultiModelTask = arrayTaskFactory<
  TextQuestionAnswerMultiModelTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(TextQuestionAnswerTask, "model");

type TextQuestionAnswerMultiContextTaskInput = ConvertOneToArray<
  TextQuestionAnswerTaskInput,
  "context"
>;
export const TextQuestionAnswerMultiContextTask = arrayTaskFactory<
  TextQuestionAnswerMultiContextTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(TextQuestionAnswerTask, "context");

type TextQuestionAnswerMultiQuestionTaskInput = ConvertOneToArray<
  TextQuestionAnswerTaskInput,
  "question"
>;
export const TextQuestionAnswerMultiQuestionTask = arrayTaskFactory<
  TextQuestionAnswerMultiQuestionTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(TextQuestionAnswerTask, "question");

type TextQuestionAnswerMultiContextMultiModelTaskInput = ConvertOneToArray<
  TextQuestionAnswerMultiModelTaskInput,
  "context"
>;
export const TextQuestionAnswerMultiContextMultiModelTask = arrayTaskFactory<
  TextQuestionAnswerMultiContextMultiModelTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(TextQuestionAnswerMultiModelTask, "context", "TextQuestionAnswerMultiContextMultiModelTask");

type TextQuestionAnswerMultiQuestionMultiModelTaskInput = ConvertOneToArray<
  TextQuestionAnswerMultiModelTaskInput,
  "question"
>;
export const TextQuestionAnswerMultiQuestionMultiModelTask = arrayTaskFactory<
  TextQuestionAnswerMultiQuestionMultiModelTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(TextQuestionAnswerMultiModelTask, "context", "TextQuestionAnswerMultiQuestionMultiModelTask");

type TextQuestionAnswerMultiQuestionMultiContextTaskInput = ConvertOneToArray<
  TextQuestionAnswerMultiContextTaskInput,
  "question"
>;
export const TextQuestionAnswerMultiQuestionMultiContextTask = arrayTaskFactory<
  TextQuestionAnswerMultiQuestionMultiContextTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(
  TextQuestionAnswerMultiQuestionTask,
  "context",
  "TextQuestionAnswerMultiQuestionMultiContextTask"
);

type TextQuestionAnswerMultiQuestionMultiContextMultiModelTaskInput = ConvertOneToArray<
  TextQuestionAnswerMultiQuestionMultiContextTaskInput,
  "model"
>;
export const TextQuestionAnswerMultiQuestionMultiContextMultiModelTask = arrayTaskFactory<
  TextQuestionAnswerMultiQuestionMultiContextMultiModelTaskInput,
  TextQuestionAnswerMultiTaskOutput
>(
  TextQuestionAnswerMultiQuestionMultiContextTask,
  "model",
  "TextQuestionAnswerMultiQuestionMultiContextMultiModelTask"
);

export const TextQuestionAnser = (
  input: ConvertOneToOptionalArrays<
    ConvertOneToOptionalArrays<
      ConvertOneToOptionalArrays<TextQuestionAnswerTaskInput, "model">,
      "context"
    >,
    "question"
  >
) => {
  if (Array.isArray(input.model) && Array.isArray(input.question) && Array.isArray(input.context)) {
    return new TextQuestionAnswerMultiQuestionMultiContextMultiModelTask()
      .addInputData(input)
      .run();
  } else if (Array.isArray(input.question) && Array.isArray(input.context)) {
    return new TextQuestionAnswerMultiQuestionMultiContextTask().addInputData(input).run();
  } else if (Array.isArray(input.model) && Array.isArray(input.question)) {
    return new TextQuestionAnswerMultiQuestionMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.model) && Array.isArray(input.context)) {
    return new TextQuestionAnswerMultiContextMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.question)) {
    return new TextQuestionAnswerMultiQuestionTask().addInputData(input).run();
  } else if (Array.isArray(input.model)) {
    return new TextQuestionAnswerMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.context)) {
    return new TextQuestionAnswerMultiContextTask().addInputData(input).run();
  } else {
    return new TextQuestionAnswerTask().addInputData(input).run();
  }
};

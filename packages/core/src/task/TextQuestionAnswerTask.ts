//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ConvertAllToArrays,
  ConvertSomeToArray,
  ConvertSomeToOptionalArray,
  arrayTaskFactory,
} from "./base/ArrayTask";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";
import { JobQueueTaskConfig } from "./base/JobQueueTask";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";

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
  public static outputs = [{ id: "text", name: "Answer", valueType: "text" }] as const;
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

type TextQuestionAnswerCompoundTaskOutput = ConvertAllToArrays<TextQuestionAnswerTaskOutput>;

type TextQuestionAnswerCompoundTaskInput = ConvertSomeToOptionalArray<
  TextQuestionAnswerTaskInput,
  "model" | "context" | "question"
>;

export const TextQuestionAnswerCompoundTask = arrayTaskFactory<
  TextQuestionAnswerCompoundTaskInput,
  TextQuestionAnswerCompoundTaskOutput
>(TextQuestionAnswerTask, ["model", "context", "question"]);

export const TextQuestionAnswer = (input: TextQuestionAnswerCompoundTaskInput) => {
  return new TextQuestionAnswerCompoundTask({ input }).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    TextQuestionAnswer: TaskGraphBuilderHelper<TextQuestionAnswerCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextQuestionAnswer = TaskGraphBuilderHelper(
  TextQuestionAnswerCompoundTask
);

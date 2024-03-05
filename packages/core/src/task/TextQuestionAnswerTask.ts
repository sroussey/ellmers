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

export type TextQuestionAnswerTaskInput = CreateMappedType<typeof TextQuestionAnswerTask.inputs>;
export type TextQuestionAnswerTaskOutput = CreateMappedType<typeof TextQuestionAnswerTask.outputs>;

/**
 * This is a special case of text generation that takes a context and a question
 */
export class TextQuestionAnswerTask extends ModelFactory {
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

  declare runInputData: TextQuestionAnswerTaskInput;
  declare runOutputData: TextQuestionAnswerTaskOutput;
  declare defaults: Partial<TextQuestionAnswerTaskInput>;
  static readonly type = "TextQuestionAnswerTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextQuestionAnswerTask);

export const TextQuestionAnswerMultiModelTask = arrayTaskFactory<
  ConvertToArrays<TextQuestionAnswerTaskInput, "model">,
  ConvertAllToArrays<TextQuestionAnswerTaskOutput>
>(TextQuestionAnswerTask, "model");

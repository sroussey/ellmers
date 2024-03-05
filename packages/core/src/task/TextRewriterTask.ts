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

export type TextRewriterTaskInput = CreateMappedType<typeof TextRewriterTask.inputs>;
export type TextRewriterTaskOutput = CreateMappedType<typeof TextRewriterTask.outputs>;

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 */

export class TextRewriterTask extends ModelFactory {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "prompt",
      name: "Prompt",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_generation_model",
    },
  ] as const;
  public static outputs = [{ id: "text", name: "Text", valueType: "text" }] as const;

  declare runInputData: TextRewriterTaskInput;
  declare runOutputData: TextRewriterTaskOutput;
  declare defaults: Partial<TextRewriterTaskInput>;
  static readonly type = "TextRewriterTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextRewriterTask);

export const TextRewriterMultiModelTask = arrayTaskFactory<
  ConvertToArrays<TextRewriterTaskInput, "model">,
  ConvertAllToArrays<TextRewriterTaskOutput>
>(TextRewriterTask, "model");

export const MultiTextRewriterMultiModelTask = arrayTaskFactory<
  ConvertToArrays<ConvertToArrays<TextRewriterTaskInput, "model">, "text">,
  ConvertAllToArrays<TextRewriterTaskOutput>
>(TextRewriterMultiModelTask, "text");

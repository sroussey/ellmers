//    *******************************************************************************
//    *   ELLMERS: TextGeneration Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ConvertAllToArrays, ConvertToArrays, arrayTaskFactory } from "./base/ArrayTask";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";
import { ModelFactory } from "./base/ModelFactory";

export type TextGenerationTaskInput = CreateMappedType<typeof TextGenerationTask.inputs>;
export type TextGenerationTaskOutput = CreateMappedType<typeof TextGenerationTask.outputs>;

/**
 * This generates text from a prompt
 */
export class TextGenerationTask extends ModelFactory {
  public static inputs = [
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

  declare runInputData: TextGenerationTaskInput;
  declare runOutputData: TextGenerationTaskOutput;
  declare defaults: Partial<TextGenerationTaskInput>;
  static readonly type = "TextGenerationTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextGenerationTask);

export const TextGenerationMultiModelTask = arrayTaskFactory<
  ConvertToArrays<TextGenerationTaskInput, "model">,
  ConvertAllToArrays<TextGenerationTaskOutput>
>(TextGenerationTask, "model");

export const TextGenerationMultiPromptTask = arrayTaskFactory<
  ConvertToArrays<TextGenerationTaskInput, "prompt">,
  ConvertAllToArrays<TextGenerationTaskOutput>
>(TextGenerationTask, "prompt");

export const TextGenerationMultiPromptModelTask = arrayTaskFactory<
  ConvertToArrays<ConvertToArrays<TextGenerationTaskInput, "model">, "prompt">,
  ConvertAllToArrays<TextGenerationTaskOutput>
>(TextGenerationMultiModelTask, "prompt", "TextGenerationMultiPromptModelTask");

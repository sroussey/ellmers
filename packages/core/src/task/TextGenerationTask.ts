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

export type TextGenerationTaskInput = CreateMappedType<typeof TextGenerationTask.inputs>;
export type TextGenerationTaskOutput = CreateMappedType<typeof TextGenerationTask.outputs>;

/**
 * This generates text from a prompt
 */
export class TextGenerationTask extends JobQueueLlmTask {
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
  constructor(config: JobQueueTaskConfig & { input?: TextGenerationTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextGenerationTaskInput;
  declare runOutputData: TextGenerationTaskOutput;
  declare defaults: Partial<TextGenerationTaskInput>;
  static readonly type = "TextGenerationTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextGenerationTask);

type TextGenerationMultiTaskOutput = ConvertAllToArrays<TextGenerationTaskOutput>;

type TextGenerationMultiModelTaskInput = ConvertOneToArray<TextGenerationTaskInput, "model">;
export const TextGenerationMultiModelTask = arrayTaskFactory<
  TextGenerationMultiModelTaskInput,
  TextGenerationMultiTaskOutput
>(TextGenerationTask, "model");

type TextGenerationMultiPromptTaskInput = ConvertOneToArray<TextGenerationTaskInput, "prompt">;
export const TextGenerationMultiPromptTask = arrayTaskFactory<
  TextGenerationMultiPromptTaskInput,
  TextGenerationMultiTaskOutput
>(TextGenerationTask, "prompt");

type TextGenerationMultiPromptMultiModelTaskInput = ConvertOneToArray<
  TextGenerationMultiModelTaskInput,
  "prompt"
>;
export const TextGenerationMultiPromptMultiModelTask = arrayTaskFactory<
  TextGenerationMultiPromptMultiModelTaskInput,
  TextGenerationMultiTaskOutput
>(TextGenerationMultiModelTask, "prompt", "TextGenerationMultiPromptMultiModelTask");

export const TextGeneration = (
  input: ConvertOneToOptionalArrays<
    ConvertOneToOptionalArrays<TextGenerationTaskInput, "model">,
    "prompt"
  >
) => {
  if (Array.isArray(input.model) && Array.isArray(input.prompt)) {
    return new TextGenerationMultiPromptMultiModelTask({ input } as any).run();
  } else if (Array.isArray(input.model)) {
    return new TextGenerationMultiModelTask({ input } as any).run();
  } else if (Array.isArray(input.prompt)) {
    return new TextGenerationMultiPromptTask({ input } as any).run();
  } else {
    return new TextGenerationTask({ input } as any).run();
  }
};

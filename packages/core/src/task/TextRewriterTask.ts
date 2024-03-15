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

export type TextRewriterTaskInput = CreateMappedType<typeof TextRewriterTask.inputs>;
export type TextRewriterTaskOutput = CreateMappedType<typeof TextRewriterTask.outputs>;

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 */

export class TextRewriterTask extends JobQueueLlmTask {
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
  constructor(config: JobQueueTaskConfig & { input?: TextRewriterTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextRewriterTaskInput;
  declare runOutputData: TextRewriterTaskOutput;
  declare defaults: Partial<TextRewriterTaskInput>;
  static readonly type = "TextRewriterTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextRewriterTask);

type TextRewriterMultiTaskOutput = ConvertAllToArrays<TextRewriterTaskOutput>;

type TextRewriterMultiModelTaskInput = ConvertOneToArray<TextRewriterTaskInput, "model">;
export const TextRewriterMultiModelTask = arrayTaskFactory<
  TextRewriterMultiModelTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterTask, "model");

type TextRewriterMultiTextTaskInput = ConvertOneToArray<TextRewriterTaskInput, "text">;
export const TextRewriterMultiTextTask = arrayTaskFactory<
  TextRewriterMultiTextTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterTask, "text");

type TextRewriterMultiPromptTaskInput = ConvertOneToArray<TextRewriterTaskInput, "prompt">;
export const TextRewriterMultiPromptTask = arrayTaskFactory<
  TextRewriterMultiPromptTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterTask, "prompt");

type TextRewriterMultiTextMultiModelTaskInput = ConvertOneToArray<
  TextRewriterMultiModelTaskInput,
  "text"
>;
export const TextRewriterMultiTextMultiModelTask = arrayTaskFactory<
  TextRewriterMultiTextMultiModelTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterMultiModelTask, "text", "TextRewriterMultiTextMultiModelTask");

type TextRewriterMultiPromptMultiModelTaskInput = ConvertOneToArray<
  TextRewriterMultiModelTaskInput,
  "prompt"
>;
export const TextRewriterMultiPromptMultiModelTask = arrayTaskFactory<
  TextRewriterMultiPromptMultiModelTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterMultiModelTask, "text", "TextRewriterMultiPromptMultiModelTask");

type TextRewriterMultiPromptMultiTextTaskInput = ConvertOneToArray<
  TextRewriterMultiTextTaskInput,
  "prompt"
>;
export const TextRewriterMultiPromptMultiTextTask = arrayTaskFactory<
  TextRewriterMultiPromptMultiTextTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterMultiPromptTask, "text", "TextRewriterMultiPromptMultiTextTask");

type TextRewriterMultiPromptMultiTextMultiModelTaskInput = ConvertOneToArray<
  TextRewriterMultiPromptMultiTextTaskInput,
  "model"
>;
export const TextRewriterMultiPromptMultiTextMultiModelTask = arrayTaskFactory<
  TextRewriterMultiPromptMultiTextMultiModelTaskInput,
  TextRewriterMultiTaskOutput
>(TextRewriterMultiPromptMultiTextTask, "model", "TextRewriterMultiPromptMultiTextMultiModelTask");

export const TextRewriter = (
  input: ConvertOneToOptionalArrays<
    ConvertOneToOptionalArrays<ConvertOneToOptionalArrays<TextRewriterTaskInput, "model">, "text">,
    "prompt"
  >
) => {
  if (Array.isArray(input.model) && Array.isArray(input.prompt) && Array.isArray(input.text)) {
    return new TextRewriterMultiPromptMultiTextMultiModelTask({ input } as any).run();
  } else if (Array.isArray(input.prompt) && Array.isArray(input.text)) {
    return new TextRewriterMultiPromptMultiTextTask({ input } as any).run();
  } else if (Array.isArray(input.model) && Array.isArray(input.prompt)) {
    return new TextRewriterMultiPromptMultiModelTask({ input } as any).run();
  } else if (Array.isArray(input.model) && Array.isArray(input.text)) {
    return new TextRewriterMultiTextMultiModelTask({ input } as any).run();
  } else if (Array.isArray(input.prompt)) {
    return new TextRewriterMultiPromptTask({ input } as any).run();
  } else if (Array.isArray(input.model)) {
    return new TextRewriterMultiModelTask({ input } as any).run();
  } else if (Array.isArray(input.text)) {
    return new TextRewriterMultiTextTask({ input } as any).run();
  } else {
    return new TextRewriterTask({ input } as any).run();
  }
};

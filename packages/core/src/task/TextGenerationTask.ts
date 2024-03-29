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

type TextGenerationCompoundOutput = ConvertAllToArrays<TextGenerationTaskOutput>;

type TextGenerationCompoundTaskInput = ConvertSomeToOptionalArray<
  TextGenerationTaskInput,
  "model" | "prompt"
>;
export const TextGenerationCompoundTask = arrayTaskFactory<
  TextGenerationCompoundTaskInput,
  TextGenerationCompoundOutput
>(TextGenerationTask, ["model", "prompt"]);

export const TextGeneration = (input: TextGenerationCompoundTaskInput) => {
  return new TextGenerationCompoundTask({ input }).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    TextGeneration: TaskGraphBuilderHelper<TextGenerationCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextGeneration = TaskGraphBuilderHelper(TextGenerationCompoundTask);

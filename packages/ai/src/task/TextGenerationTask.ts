//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  ConvertAllToArrays,
  ConvertSomeToOptionalArray,
  arrayTaskFactory,
  TaskRegistry,
  JobQueueTaskConfig,
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
} from "@ellmers/task-graph";
import { JobQueueAiTask } from "./base/JobQueueAiTask";
import { generation_model } from "./base/TaskIOTypes";

export type TextGenerationTaskInput = {
  prompt: string;
  model: generation_model;
};
export type TextGenerationTaskOutput = {
  text: string;
};

/**
 * This generates text from a prompt
 */
export class TextGenerationTask extends JobQueueAiTask {
  public static inputs = [
    {
      id: "prompt",
      name: "Prompt",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "generation_model",
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

/**
 * Factory-generated task class for handling batch text generation operations.
 * Created using arrayTaskFactory to support processing multiple prompts/models simultaneously.
 */
export const TextGenerationCompoundTask = arrayTaskFactory<
  TextGenerationCompoundTaskInput,
  TextGenerationCompoundOutput,
  TextGenerationTaskOutput
>(TextGenerationTask, ["model", "prompt"]);

/**
 * Convenience function to run text generation tasks.
 * Creates and executes a TextGenerationCompoundTask with the provided input.
 * @param input The input parameters for text generation (prompts and models)
 * @returns Promise resolving to the generated text output(s)
 */
export const TextGeneration = (input: TextGenerationCompoundTaskInput) => {
  return new TextGenerationCompoundTask({ input }).run();
};

declare module "@ellmers/task-graph" {
  interface TaskGraphBuilder {
    TextGeneration: TaskGraphBuilderHelper<TextGenerationCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextGeneration = TaskGraphBuilderHelper(TextGenerationCompoundTask);

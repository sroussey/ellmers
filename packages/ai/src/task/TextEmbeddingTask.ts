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
  CreateMappedType,
  TaskRegistry,
  JobQueueTaskConfig,
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
} from "ellmers-core";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";

export type TextEmbeddingTaskInput = CreateMappedType<typeof TextEmbeddingTask.inputs>;
export type TextEmbeddingTaskOutput = CreateMappedType<typeof TextEmbeddingTask.outputs>;

/**
 * This is a task that generates an embedding for a single piece of text
 */
export class TextEmbeddingTask extends JobQueueLlmTask {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "text_embedding_model",
    },
  ] as const;
  public static outputs = [{ id: "vector", name: "Embedding", valueType: "vector" }] as const;
  constructor(config: JobQueueTaskConfig & { input?: TextEmbeddingTaskInput } = {}) {
    super(config);
  }
  declare runInputData: TextEmbeddingTaskInput;
  declare runOutputData: TextEmbeddingTaskOutput;
  declare defaults: Partial<TextEmbeddingTaskInput>;
  static readonly type = "TextEmbeddingTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(TextEmbeddingTask);

type TextEmbeddingCompoundTaskOutput = ConvertAllToArrays<TextEmbeddingTaskOutput>;
type TextEmbeddingCompoundTaskInput = ConvertSomeToOptionalArray<TextEmbeddingTaskInput, "model">;

export const TextEmbeddingCompoundTask = arrayTaskFactory<
  TextEmbeddingCompoundTaskInput,
  TextEmbeddingCompoundTaskOutput
>(TextEmbeddingTask, ["model", "text"]);

export const TextEmbedding = (input: TextEmbeddingCompoundTaskInput) => {
  return new TextEmbeddingCompoundTask({ input }).run();
};

declare module "ellmers-core" {
  interface TaskGraphBuilder {
    TextEmbedding: TaskGraphBuilderHelper<TextEmbeddingCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextEmbedding = TaskGraphBuilderHelper(TextEmbeddingCompoundTask);

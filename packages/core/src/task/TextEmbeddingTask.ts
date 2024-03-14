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

export type EmbeddingTaskInput = CreateMappedType<typeof EmbeddingTask.inputs>;
export type EmbeddingTaskOutput = CreateMappedType<typeof EmbeddingTask.outputs>;

/**
 * This is a task that generates an embedding for a single piece of text
 */
export class EmbeddingTask extends JobQueueLlmTask {
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
  constructor(config: JobQueueTaskConfig & { input?: EmbeddingTaskInput } = {}) {
    super(config);
  }
  declare runInputData: EmbeddingTaskInput;
  declare runOutputData: EmbeddingTaskOutput;
  declare defaults: Partial<EmbeddingTaskInput>;
  static readonly type = "EmbeddingTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(EmbeddingTask);

type EmbeddingMultiTaskOutput = ConvertAllToArrays<EmbeddingTaskOutput>;

type EmbeddingMultiModelTaskInput = ConvertOneToArray<EmbeddingTaskInput, "model">;
export const EmbeddingMultiModelTask = arrayTaskFactory<
  EmbeddingMultiModelTaskInput,
  EmbeddingMultiTaskOutput
>(EmbeddingTask, "model");

type EmbeddingMultiTextTaskInput = ConvertOneToArray<EmbeddingTaskInput, "text">;
export const EmbeddingMultiTextTask = arrayTaskFactory<
  EmbeddingMultiTextTaskInput,
  EmbeddingMultiTaskOutput
>(EmbeddingTask, "text");

type EmbeddingMultiTextMultiModelTaskInput = ConvertOneToArray<
  EmbeddingMultiModelTaskInput,
  "text"
>;
export const EmbeddingMultiTextMultiModelTask = arrayTaskFactory<
  EmbeddingMultiTextMultiModelTaskInput,
  EmbeddingMultiTaskOutput
>(EmbeddingMultiModelTask, "text", "EmbeddingMultiTextMultiModelTask");

export const TextEmbedding = (
  input: ConvertOneToOptionalArrays<ConvertOneToOptionalArrays<EmbeddingTaskInput, "model">, "text">
) => {
  if (Array.isArray(input.model) && Array.isArray(input.text)) {
    return new EmbeddingMultiTextMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.model)) {
    return new EmbeddingMultiModelTask().addInputData(input).run();
  } else if (Array.isArray(input.text)) {
    return new EmbeddingMultiTextTask().addInputData(input).run();
  } else {
    return new EmbeddingTask().addInputData(input).run();
  }
};

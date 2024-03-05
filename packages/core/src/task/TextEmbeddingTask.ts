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

export type EmbeddingTaskInput = CreateMappedType<typeof EmbeddingTask.inputs>;
export type EmbeddingTaskOutput = CreateMappedType<typeof EmbeddingTask.outputs>;

/**
 * This is a task that generates an embedding for a single piece of text
 */
export class EmbeddingTask extends ModelFactory {
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

  declare runInputData: EmbeddingTaskInput;
  declare runOutputData: EmbeddingTaskOutput;
  declare defaults: Partial<EmbeddingTaskInput>;
  static readonly type = "EmbeddingTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(EmbeddingTask);

export const EmbeddingMultiModelTask = arrayTaskFactory<
  ConvertToArrays<EmbeddingTaskInput, "model">,
  ConvertAllToArrays<EmbeddingTaskOutput>
>(EmbeddingTask, "model");

export const EmbeddingMultiTextTask = arrayTaskFactory<
  ConvertToArrays<EmbeddingTaskInput, "text">,
  ConvertAllToArrays<EmbeddingTaskOutput>
>(EmbeddingTask, "text");

export const EmbeddingMultiTextModelTask = arrayTaskFactory<
  ConvertToArrays<ConvertToArrays<EmbeddingTaskInput, "model">, "text">,
  ConvertAllToArrays<EmbeddingTaskOutput>
>(EmbeddingMultiModelTask, "text", "EmbeddingMultiTextModelTask");

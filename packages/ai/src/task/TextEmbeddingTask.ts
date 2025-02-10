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
import { AnyNumberArray, embedding_model } from "./base/TaskIOTypes";
import { ElVector } from "./base/TaskIOTypes";

export type TextEmbeddingTaskInput = {
  text: string;
  model: embedding_model;
};
export type TextEmbeddingTaskOutput = {
  vector: ElVector<AnyNumberArray>;
};

/**
 * A task that generates vector embeddings for text using a specified embedding model.
 * Embeddings are numerical representations of text that capture semantic meaning,
 * useful for similarity comparisons and semantic search.
 *
 * @extends JobQueueAiTask
 */
export class TextEmbeddingTask extends JobQueueAiTask {
  public static inputs = [
    {
      id: "text",
      name: "Text",
      valueType: "text",
    },
    {
      id: "model",
      name: "Model",
      valueType: "embedding_model",
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

/**
 * A compound task factory that creates a task capable of processing multiple texts
 * and generating embeddings in parallel
 */
export const TextEmbeddingCompoundTask = arrayTaskFactory<
  TextEmbeddingCompoundTaskInput,
  TextEmbeddingCompoundTaskOutput,
  TextEmbeddingTaskOutput
>(TextEmbeddingTask, ["model", "text"]);

/**
 * Convenience function to create and run a TextEmbeddingCompoundTask
 * @param {TextEmbeddingCompoundTaskInput} input - Input containing text(s) and model(s) for embedding
 * @returns {Promise<TextEmbeddingCompoundTaskOutput>} Promise resolving to the generated embeddings
 */
export const TextEmbedding = (input: TextEmbeddingCompoundTaskInput) => {
  return new TextEmbeddingCompoundTask({ input }).run();
};

declare module "@ellmers/task-graph" {
  interface TaskGraphBuilder {
    TextEmbedding: TaskGraphBuilderHelper<TextEmbeddingCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.TextEmbedding = TaskGraphBuilderHelper(TextEmbeddingCompoundTask);

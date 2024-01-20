//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model } from "#/Model";
import { Strategy, Task, TaskConfig, TaskStreamable } from "#/Task";
import {
  EmbeddingTaskInput,
  QuestionAnswerTaskInput,
  RewriterTaskInput,
  TextGenerationTaskInput,
} from "./FactoryTasks";
import {
  EmbeddingStrategyInput,
  RewriterEmbeddingStrategyInput,
  RewriterStrategyInput,
  SummarizeStrategyInput,
} from "./Strategies";

type TaskListJsonInput = {
  run: "SerialTaskList" | "ParallelTaskList";
  config?: TaskConfig;
  tasks: TaskJsonInput[];
};

type ChangeToString<T, K extends PropertyKey[]> = {
  [P in keyof T]: P extends K[number]
    ? string
    : T[P] extends object
    ? ChangeToString<T[P], K>
    : T[P];
};
type FactoryHelper<T, R = string> = {
  run: R;
  config?: TaskConfig;
  input: ChangeToString<T, ["model"]>;
};

type StrategyHelper<T, R = string, N = string> = {
  run: R;
  config?: TaskConfig;
  input: ChangeToString<T, ["model", "models", "prompt_model", "embed_model"]>;
};

type FactoryTasksJsonInput =
  | FactoryHelper<EmbeddingTaskInput, "EmbeddingTask">
  | FactoryHelper<RewriterTaskInput, "RewriterTask">
  | FactoryHelper<TextGenerationTaskInput, "TextGenerationTask">
  | FactoryHelper<TextGenerationTaskInput, "SummarizeTask">
  | FactoryHelper<QuestionAnswerTaskInput, "QuestionAnswerTask">;

type StrategyJSONInput =
  | StrategyHelper<EmbeddingStrategyInput, "EmbeddingStrategy">
  | StrategyHelper<RewriterStrategyInput, "RewriterStrategy">
  | StrategyHelper<SummarizeStrategyInput, "SummarizeStrategy">
  | StrategyHelper<RewriterEmbeddingStrategyInput, "RewriterEmbeddingStrategy">;

export type TaskJsonInput =
  | StrategyJSONInput
  | TaskListJsonInput
  | FactoryTasksJsonInput;

function lookupModel(model: string): Model {
  const realModel = Model.all.get(model);
  if (!(realModel instanceof Model)) throw new Error("Model not found");
  return realModel;
}

function convertJson(json: TaskJsonInput): TaskStreamable | undefined {
  const { run, config } = json;
  if (run == "SerialTaskList" || run == "ParallelTaskList") {
    const tasks = json.tasks.map(convertJson);
    const runTask = Task.all.get(run);
    if (!runTask) throw new Error("Task not found");
    return new runTask(config, tasks);
  } else {
    if (
      run == "EmbeddingTask" ||
      run == "RewriterTask" ||
      run == "SummarizeTask" ||
      run == "TextGenerationTask" ||
      run == "QuestionAnswerTask"
    ) {
      const runTask = Task.all.get(run);
      if (!runTask) throw new Error("Task not found");
      const input = json.input;
      console.log({ json });
      const model = lookupModel(input.model);
      return new runTask(config, { ...input, model });
    }
  }
}

export class JsonStrategy extends Strategy {
  declare input: TaskJsonInput;
  constructor(config: TaskConfig = {}, defaults?: TaskJsonInput) {
    super(config, defaults);
  }
  generateTasks() {
    let task: TaskStreamable | undefined;
    try {
      task = convertJson(this.input);
    } catch (e) {
      throw new Error(`Error converting json: ${String(e)}`);
    }
    if (!task) throw new Error("Task not found");
    this.setTasks([task]);
  }
}

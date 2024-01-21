//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import {
  ParallelTaskList,
  SerialTaskList,
  Strategy,
  TaskConfig,
  TaskStreamable,
} from "#/Task";
import { findModelByName } from "#/storage/InMemoryStorage";
import { RenameTask, RenameTaskInput } from "./BasicTasks";
import {
  EmbeddingTask,
  EmbeddingTaskInput,
  QuestionAnswerTask,
  QuestionAnswerTaskInput,
  RewriterTask,
  RewriterTaskInput,
  SummarizeTask,
  TextGenerationTask,
  TextGenerationTaskInput,
} from "./FactoryTasks";
import {
  EmbeddingStrategy,
  EmbeddingStrategyInput,
  RewriterEmbeddingStrategy,
  RewriterEmbeddingStrategyInput,
  RewriterStrategy,
  RewriterStrategyInput,
  SummarizeStrategy,
  SummarizeStrategyInput,
} from "./Strategies";

const AllRegisteredTasks = new Map<string, { new (...args: any[]): any }>();

AllRegisteredTasks.set("SerialTaskList", SerialTaskList);
AllRegisteredTasks.set("ParallelTaskList", ParallelTaskList);

AllRegisteredTasks.set("RenameTask", RenameTask);

AllRegisteredTasks.set("EmbeddingTask", EmbeddingTask);
AllRegisteredTasks.set("RewriterTask", RewriterTask);
AllRegisteredTasks.set("TextGenerationTask", TextGenerationTask);
AllRegisteredTasks.set("SummarizeTask", SummarizeTask);
AllRegisteredTasks.set("QuestionAnswerTask", QuestionAnswerTask);

AllRegisteredTasks.set("EmbeddingStrategy", EmbeddingStrategy);
AllRegisteredTasks.set("RewriterStrategy", RewriterStrategy);
AllRegisteredTasks.set("SummarizeStrategy", SummarizeStrategy);
AllRegisteredTasks.set("RewriterEmbeddingStrategy", RewriterEmbeddingStrategy);

type TaskListJsonInput = {
  run: "SerialTaskList" | "ParallelTaskList";
  config?: TaskConfig;
  tasks: TaskJsonInput[];
};

type SimpleTasks = {
  run: "RenameTask";
  config?: TaskConfig;
  input: RenameTaskInput;
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
  | SimpleTasks
  | FactoryTasksJsonInput;

function convertJson(json: TaskJsonInput): TaskStreamable {
  const { run, config } = json;
  const runTask = AllRegisteredTasks.get(run);
  if (!runTask) throw new Error("Task not found");
  let result: TaskStreamable;
  if (run == "SerialTaskList" || run == "ParallelTaskList") {
    const tasks = json.tasks.map(convertJson);
    result = new runTask(config, tasks);
  } else if (
    run == "EmbeddingTask" ||
    run == "RewriterTask" ||
    run == "SummarizeTask" ||
    run == "TextGenerationTask" ||
    run == "QuestionAnswerTask"
  ) {
    const input = json.input;
    const model = findModelByName(input.model);
    if (!model) throw new Error(`Model not found: ${input.model}`);
    result = new runTask(config, { ...input, model });
  } else if (run == "RenameTask") {
    result = new runTask(config, json.input);
  } else {
    throw new Error(`Unknown task type: ${run}`);
  }
  return result;
}

export class JsonStrategy extends Strategy {
  declare input: { tasks: TaskJsonInput[] };
  constructor(
    config: TaskConfig = {},
    defaults?: TaskJsonInput | TaskJsonInput[]
  ) {
    const tasks = Array.isArray(defaults) ? defaults : [defaults];
    super(config, { tasks });
  }
  generateTasks() {
    let task: TaskStreamable[];
    try {
      task = this.input.tasks.map(convertJson);
    } catch (e) {
      throw new Error(`Error converting json: ${String(e)}`);
    }
    if (!task) throw new Error("Task not found");
    this.setTasks(task);
  }
}

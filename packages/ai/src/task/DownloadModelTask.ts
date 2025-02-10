//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
  TaskRegistry,
  ConvertAllToArrays,
  ConvertSomeToOptionalArray,
  arrayTaskFactory,
  TaskOutput,
  JobQueueTaskConfig,
} from "@ellmers/task-graph";
import { getGlobalModelRepository } from "../model/ModelRegistry";
import { JobQueueAiTask } from "./base/JobQueueAiTask";
import {
  embedding_model,
  generation_model,
  model,
  question_answering_model,
  summarization_model,
  translation_model,
} from "./base/TaskIOTypes";

export type DownloadModelTaskInput = {
  model: string;
};
export type DownloadModelTaskOutput = {
  model: model;
  dimensions: number;
  normalize: boolean;
  embedding_model: embedding_model;
  generation_model: generation_model;
  summarization_model: summarization_model;
  question_answering_model: question_answering_model;
  translation_model: translation_model;
};

export class DownloadModelTask extends JobQueueAiTask {
  public static inputs = [
    {
      id: "model",
      name: "Model",
      valueType: "model",
    },
  ] as const;
  public static outputs = [
    {
      id: "model",
      name: "Model",
      valueType: "model",
    },
    {
      id: "dimensions",
      name: "Dimensions",
      valueType: "number",
    },
    {
      id: "normalize",
      name: "Normalize",
      valueType: "boolean",
    },
    {
      id: "embedding_model",
      name: "",
      valueType: "embedding_model",
    },
    {
      id: "generation_model",
      name: "",
      valueType: "generation_model",
    },
    {
      id: "summarization_model",
      name: "",
      valueType: "summarization_model",
    },
    {
      id: "question_answering_model",
      name: "",
      valueType: "question_answering_model",
    },
    {
      id: "translation_model",
      name: "",
      valueType: "translation_model",
    },
  ] as const;
  static sideeffects = true;
  declare runInputData: DownloadModelTaskInput;
  declare runOutputData: DownloadModelTaskOutput;
  declare defaults: Partial<DownloadModelTaskInput>;
  constructor(config: JobQueueTaskConfig & { input?: DownloadModelTaskInput } = {}) {
    super(config);
  }
  async runReactive(): Promise<TaskOutput> {
    const model = await getGlobalModelRepository().findByName(this.runInputData.model);
    if (model) {
      const tasks = (await getGlobalModelRepository().findTasksByModel(model.name)) || [];
      tasks.forEach((task) => {
        // this.runOutputData[String(task).toLowerCase()] = model.name;
      });
      this.runOutputData.model = model.name;
      this.runOutputData.dimensions = model.usingDimensions!;
      this.runOutputData.normalize = model.normalize!;
      if (tasks.includes("TextEmbeddingTask")) {
        this.runOutputData.embedding_model = model.name;
      }
      if (tasks.includes("TextGenerationTask")) {
        this.runOutputData.generation_model = model.name;
      }
      if (tasks.includes("TextSummaryTask")) {
        this.runOutputData.summarization_model = model.name;
      }
      if (tasks.includes("TextQuestionAnswerTask")) {
        this.runOutputData.question_answering_model = model.name;
      }
      if (tasks.includes("TextTranslationTask")) {
        this.runOutputData.translation_model = model.name;
      }
    }
    return this.runOutputData;
  }
  static readonly type = "DownloadModelTask";
  static readonly category = "Text Model";
}

TaskRegistry.registerTask(DownloadModelTask);

type DownloadModelCompoundTaskInput = ConvertSomeToOptionalArray<DownloadModelTaskInput, "model">;
export const DownloadModelCompoundTask = arrayTaskFactory<
  DownloadModelCompoundTaskInput,
  ConvertAllToArrays<DownloadModelTaskOutput>,
  DownloadModelTaskOutput
>(DownloadModelTask, ["model"]);

export const DownloadModel = (input: DownloadModelCompoundTaskInput) => {
  if (Array.isArray(input.model)) {
    return new DownloadModelCompoundTask({ input }).run();
  } else {
    return new DownloadModelTask({ input } as { input: DownloadModelTaskInput }).run();
  }
};

declare module "@ellmers/task-graph" {
  interface TaskGraphBuilder {
    DownloadModel: TaskGraphBuilderHelper<DownloadModelCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.DownloadModel =
  TaskGraphBuilderHelper<DownloadModelCompoundTaskInput>(DownloadModelCompoundTask);

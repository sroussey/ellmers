//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ConvertAllToArrays, ConvertSomeToOptionalArray, arrayTaskFactory } from "./base/ArrayTask";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";
import { TaskOutput } from "./base/Task";
import { JobQueueTaskConfig } from "./base/JobQueueTask";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { findModelByName } from "browser";

export type DownloadModelTaskInput = CreateMappedType<typeof DownloadModelTask.inputs>;
export type DownloadModelTaskOutput = CreateMappedType<typeof DownloadModelTask.outputs>;

export class DownloadModelTask extends JobQueueLlmTask {
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
      id: "text_embedding_model",
      name: "",
      valueType: "text_embedding_model",
    },
    {
      id: "text_generation_model",
      name: "",
      valueType: "text_generation_model",
    },
    {
      id: "text_summarization_model",
      name: "",
      valueType: "text_summarization_model",
    },
    {
      id: "text_question_answering_model",
      name: "",
      valueType: "text_question_answering_model",
    },
  ] as const;

  declare runInputData: DownloadModelTaskInput;
  declare runOutputData: DownloadModelTaskOutput;
  declare defaults: Partial<DownloadModelTaskInput>;
  constructor(config: JobQueueTaskConfig & { input?: DownloadModelTaskInput } = {}) {
    super(config);
  }
  runSyncOnly(): TaskOutput {
    const model = findModelByName(this.runInputData.model);
    if (model) {
      // @ts-expect-error
      this.runOutputData[String(model.useCase).toLowerCase()] = model.name;
      this.runOutputData.model = model.name;
      this.runOutputData.dimensions = model.dimensions!;
      this.runOutputData.normalize = model.normalize;
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
  ConvertAllToArrays<DownloadModelTaskOutput>
>(DownloadModelTask, ["model"]);

export const DownloadModel = (input: DownloadModelCompoundTaskInput) => {
  if (Array.isArray(input.model)) {
    return new DownloadModelCompoundTask({ input }).run();
  } else {
    return new DownloadModelTask({ input } as { input: DownloadModelTaskInput }).run();
  }
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    DownloadModel: TaskGraphBuilderHelper<DownloadModelCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.DownloadModel =
  TaskGraphBuilderHelper<DownloadModelCompoundTaskInput>(DownloadModelCompoundTask);

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
  CreateMappedType,
  TaskRegistry,
  ConvertAllToArrays,
  ConvertSomeToOptionalArray,
  arrayTaskFactory,
  TaskOutput,
  JobQueueTaskConfig,
} from "ellmers-core";
import { ModelUseCaseEnum } from "../model/Model";
import { findModelByName } from "../model/InMemoryStorage";
import { JobQueueLlmTask } from "./base/JobQueueLlmTask";

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
    {
      id: "text_translation_model",
      name: "",
      valueType: "text_translation_model",
    },
  ] as const;
  static sideeffects = true;
  declare runInputData: DownloadModelTaskInput;
  declare runOutputData: DownloadModelTaskOutput;
  declare defaults: Partial<DownloadModelTaskInput>;
  constructor(config: JobQueueTaskConfig & { input?: DownloadModelTaskInput } = {}) {
    super(config);
  }
  runSyncOnly(): TaskOutput {
    const model = findModelByName(this.runInputData.model);
    if (model) {
      model.useCase.forEach((useCase) => {
        // @ts-expect-error -- we really can use this an index
        this.runOutputData[String(useCase).toLowerCase()] = model.name;
      });
      this.runOutputData.model = model.name;
      this.runOutputData.dimensions = model.dimensions!;
      this.runOutputData.normalize = model.normalize;
      if (model.useCase.includes(ModelUseCaseEnum.TEXT_EMBEDDING)) {
        this.runOutputData.text_embedding_model = model.name;
      }
      if (model.useCase.includes(ModelUseCaseEnum.TEXT_GENERATION)) {
        this.runOutputData.text_generation_model = model.name;
      }
      if (model.useCase.includes(ModelUseCaseEnum.TEXT_SUMMARIZATION)) {
        this.runOutputData.text_summarization_model = model.name;
      }
      if (model.useCase.includes(ModelUseCaseEnum.TEXT_QUESTION_ANSWERING)) {
        this.runOutputData.text_question_answering_model = model.name;
      }
      if (model.useCase.includes(ModelUseCaseEnum.TEXT_TRANSLATION)) {
        this.runOutputData.text_translation_model = model.name;
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
  ConvertAllToArrays<DownloadModelTaskOutput>
>(DownloadModelTask, ["model"]);

export const DownloadModel = (input: DownloadModelCompoundTaskInput) => {
  if (Array.isArray(input.model)) {
    return new DownloadModelCompoundTask({ input }).run();
  } else {
    return new DownloadModelTask({ input } as { input: DownloadModelTaskInput }).run();
  }
};

declare module "ellmers-core" {
  interface TaskGraphBuilder {
    DownloadModel: TaskGraphBuilderHelper<DownloadModelCompoundTaskInput>;
  }
}

TaskGraphBuilder.prototype.DownloadModel =
  TaskGraphBuilderHelper<DownloadModelCompoundTaskInput>(DownloadModelCompoundTask);

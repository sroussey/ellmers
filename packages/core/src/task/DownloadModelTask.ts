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
import { TaskOutput } from "./base/Task";
import { JobQueueTaskConfig } from "./base/JobQueueTask";

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
  ] as const;

  declare runInputData: DownloadModelTaskInput;
  declare runOutputData: DownloadModelTaskOutput;
  declare defaults: Partial<DownloadModelTaskInput>;
  constructor(config: JobQueueTaskConfig & { input?: DownloadModelTaskInput } = {}) {
    super(config);
  }
  runSyncOnly(): TaskOutput {
    this.runOutputData.model = this.runInputData.model;
    return this.runOutputData;
  }
  static readonly type = "DownloadModelTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(DownloadModelTask);

export const DownloadModelMultiModelTask = arrayTaskFactory<
  ConvertOneToArray<DownloadModelTaskInput, "model">,
  ConvertAllToArrays<DownloadModelTaskOutput>
>(DownloadModelTask, "model");

export const DownloadModel = (
  input: ConvertOneToOptionalArrays<DownloadModelTaskInput, "model">
) => {
  if (Array.isArray(input.model)) {
    return new DownloadModelMultiModelTask({ input } as any).run();
  } else {
    return new DownloadModelTask({ input } as any).run();
  }
};

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
import { TaskConfig, TaskOutput } from "./base/Task";
import { JobQueueTaskConfig } from "./base/JobQueueTask";

export type DownloadTaskInput = CreateMappedType<typeof DownloadTask.inputs>;
export type DownloadTaskOutput = CreateMappedType<typeof DownloadTask.outputs>;

export class DownloadTask extends JobQueueLlmTask {
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

  declare runInputData: DownloadTaskInput;
  declare runOutputData: DownloadTaskOutput;
  declare defaults: Partial<DownloadTaskInput>;
  constructor(config: JobQueueTaskConfig & { input?: DownloadTaskInput } = {}) {
    super(config);
  }
  runSyncOnly(): TaskOutput {
    this.runOutputData.model = this.runInputData.model;
    return this.runOutputData;
  }
  static readonly type = "DownloadTask";
  static readonly category = "Text Model";
}
TaskRegistry.registerTask(DownloadTask);

export const DownloadMultiModelTask = arrayTaskFactory<
  ConvertOneToArray<DownloadTaskInput, "model">,
  ConvertAllToArrays<DownloadTaskOutput>
>(DownloadTask, "model");

export const Download = (input: ConvertOneToOptionalArrays<DownloadTaskInput, "model">) => {
  if (Array.isArray(input.model)) {
    return new DownloadMultiModelTask({ input } as any).run();
  } else {
    return new DownloadTask({ input } as any).run();
  }
};

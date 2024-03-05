//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SingleTask, TaskConfig, TaskOutput } from "./base/Task";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";

// ===============================================================================

export type LambdaTaskInput = CreateMappedType<typeof LambdaTask.inputs>;
export type LambdaTaskOutput = CreateMappedType<typeof LambdaTask.outputs>;

export class LambdaTask extends SingleTask {
  static readonly type = "LambdaTask";
  declare runOutputData: TaskOutput;
  public static inputs = [] as const;
  public static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "any",
    },
  ] as const;
  constructor(config: TaskConfig & LambdaTaskInput) {
    super(config);
  }
  runSyncOnly() {
    if (!this.runInputData.run) {
      throw new Error("No runner provided");
    }
    if (typeof this.runInputData.run === "function") {
      this.runOutputData.output = this.runInputData.run(this.runInputData);
    } else {
      console.error("error", "Runner is not a function");
    }
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(LambdaTask);

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SingleTask, TaskConfig, TaskOutput } from "./base/Task";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";

// ===============================================================================

export type LambdaTaskInput = CreateMappedType<typeof LambdaTask.inputs>;
export type LambdaTaskOutput = CreateMappedType<typeof LambdaTask.outputs>;

export class LambdaTask extends SingleTask {
  static readonly type = "LambdaTask";
  declare runInputData: LambdaTaskInput;
  declare defaults: Partial<LambdaTaskInput>;
  declare runOutputData: TaskOutput;
  public static inputs = [
    {
      id: "fn",
      name: "Function",
      valueType: "function",
    },
    {
      id: "input",
      name: "Input",
      valueType: "any",
      defaultValue: null,
    },
  ] as const;
  public static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "any",
    },
  ] as const;
  constructor(config: TaskConfig & { input?: LambdaTaskInput } = {}) {
    super(config);
  }
  runSyncOnly() {
    if (!this.runInputData.fn) {
      throw new Error("No runner provided");
    }
    if (typeof this.runInputData.fn === "function") {
      this.runOutputData.output = this.runInputData.fn(this.runInputData.input);
    } else {
      console.error("error", "Runner is not a function");
    }
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(LambdaTask);

const LambdaBuilder = (input: LambdaTaskInput) => {
  return new LambdaTask({ input });
};

export const Lambda = (input: LambdaTaskInput) => {
  return LambdaBuilder(input).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    Lambda: TaskGraphBuilderHelper<LambdaTaskInput>;
  }
}

TaskGraphBuilder.prototype.Lambda = TaskGraphBuilderHelper(LambdaTask);

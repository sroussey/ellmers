//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { OutputTask } from "./base/OutputTask";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";

export type DebugLogTaskInput = CreateMappedType<typeof DebugLogTask.inputs>;
export type DebugLogTaskOutput = CreateMappedType<typeof DebugLogTask.outputs>;

export class DebugLogTask extends OutputTask {
  static readonly type: string = "DebugLogTask";
  static readonly category = "Output";
  declare runInputData: DebugLogTaskInput;
  declare runOutputData: DebugLogTaskOutput;
  public static inputs = [
    {
      id: "message",
      name: "Input",
      valueType: "any",
    },
    {
      id: "level",
      name: "Level",
      valueType: "log_level",
      defaultValue: "info",
    },
  ] as const;
  public static outputs = [{ id: "output", name: "Output", valueType: "any" }] as const;
  async runReactive() {
    const level = this.runInputData.level || "log";
    if (level == "dir") {
      console.dir(this.runInputData.message, { depth: null });
    } else {
      console[level](this.runInputData.message);
    }
    this.runOutputData.output = this.runInputData.message;
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(DebugLogTask);

export const DebugLog = (input: DebugLogTaskInput) => {
  return new DebugLogTask({ input }).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    DebugLog: TaskGraphBuilderHelper<DebugLogTaskInput>;
  }
}

TaskGraphBuilder.prototype.DebugLog = TaskGraphBuilderHelper(DebugLogTask);

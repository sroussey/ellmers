//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { OutputTask } from "./base/OutputTask";
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
  public static outputs = [{ id: "out", name: "Outputs", valueType: "any" }] as const;
  runSyncOnly() {
    const level = this.runInputData.level || "log";
    if (level == "dir") {
      console.dir(this.runInputData.message, { depth: null });
    } else {
      console[level](this.runInputData.message);
    }
    this.runOutputData.out = this.runInputData.message;
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(DebugLogTask);

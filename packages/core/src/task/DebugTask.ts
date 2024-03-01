//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SingleTask } from "./Task";
import { CreateMappedType } from "./TaskIOTypes";
import { TaskRegistry } from "./TaskRegistry";

export type DebugLogTaskInput = CreateMappedType<typeof DebugLogTask.inputs>;
export type DebugLogTaskOutput = CreateMappedType<typeof DebugLogTask.outputs>;

export class DebugLogTask extends SingleTask {
  static readonly type: string = "DebugLogTask";
  static readonly category = "Utility";
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
  public static outputs = [] as const;
  runSyncOnly() {
    console[this.runInputData.level || "log"](this.runInputData.message);
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(DebugLogTask);

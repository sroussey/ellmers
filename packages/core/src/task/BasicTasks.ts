//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskConfig } from "./Task";
import { SingleTask, TaskInput, TaskOutput } from "./Task";
import { CreateMappedType } from "./TaskIOTypes";
import { TaskRegistry } from "./TaskRegistry";

export interface RenameTaskInput {
  output_remap_array: {
    from: string;
    to: string;
  }[];
}

// ===============================================================================

export type LambdaTaskInput =
  | CreateMappedType<typeof LambdaTask.inputs>
  | { run: (input: TaskInput) => Promise<TaskInput> };
export type LambdaTaskOutput = CreateMappedType<typeof LambdaTask.outputs>;

export class LambdaTask extends SingleTask {
  static readonly type = "LambdaTask";
  static readonly category = "Utility";
  declare runOutputData: TaskOutput;
  public static inputs = [
    {
      id: "run",
      name: "Run Function",
      valueType: "text",
    },
  ] as const;
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
    if (typeof this.runInputData.run === "string") {
      const fnText = this.runInputData.run;
      const fn = new Function(fnText);
      try {
        fn();
        this.runInputData.run = fn;
      } catch (e) {}
    }
    if (typeof this.runInputData.run === "function") {
      this.runOutputData.output = this.runInputData.run(this.runInputData);
      console.log("lambda output", this.runOutputData);
    } else {
      console.error("error", "Runner is not a function");
    }
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(LambdaTask);

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

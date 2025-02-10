//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { OutputTask } from "./base/OutputTask";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { TaskRegistry } from "./base/TaskRegistry";

const log_levels = ["dir", "log", "debug", "info", "warn", "error"] as const;
type LogLevel = (typeof log_levels)[number];

export type DebugLogTaskInput = {
  message: any;
  level: LogLevel;
};
export type DebugLogTaskOutput = {
  output: any;
};

/**
 * DebugLogTask provides console logging functionality as a task within the system.
 *
 * Features:
 * - Supports multiple log levels (info, warn, error, dir)
 * - Passes through the logged message as output
 * - Configurable logging format and depth
 *
 * This task is particularly useful for debugging task graphs and monitoring
 * data flow between tasks during development and testing.
 */
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

  async validateItem(valueType: string, item: any) {
    if (valueType == "log_level") {
      return log_levels.includes(item);
    }
    return super.validateItem(valueType, item);
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

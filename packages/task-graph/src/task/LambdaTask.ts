//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SingleTask, TaskConfig, TaskOutput } from "./base/Task";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { TaskRegistry } from "./base/TaskRegistry";

/**
 * Type definitions for LambdaTask input and output
 * These types are generated from the static input/output definitions
 */
export type LambdaTaskInput = {
  fn: (...args: any[]) => any;
  input: any;
};
export type LambdaTaskOutput = {
  output: any;
};

/**
 * LambdaTask provides a way to execute arbitrary functions within the task framework
 * It wraps a provided function and its input into a task that can be integrated
 * into task graphs and workflows
 */
export class LambdaTask extends SingleTask {
  static readonly type = "LambdaTask";
  declare runInputData: LambdaTaskInput;
  declare defaults: Partial<LambdaTaskInput>;
  declare runOutputData: TaskOutput;

  /**
   * Input definition for LambdaTask
   * - fn: The function to execute
   * - input: Optional input data to pass to the function
   */
  public static inputs = [
    {
      id: "fn",
      name: "Function",
      valueType: "function", // Expects a callable function
    },
    {
      id: "input",
      name: "Input",
      valueType: "any", // Can accept any type of input
      defaultValue: null,
    },
  ] as const;

  /**
   * Output definition for LambdaTask
   * The output will be whatever the provided function returns
   */
  public static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "any", // Can return any type of value
    },
  ] as const;

  constructor(config: TaskConfig & { input?: LambdaTaskInput } = {}) {
    super(config);
  }

  /**
   * Executes the provided function with the given input
   * Throws an error if no function is provided or if the provided value is not callable
   */
  async runReactive() {
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

// Register LambdaTask with the task registry
TaskRegistry.registerTask(LambdaTask);

/**
 * Helper function to create and configure a LambdaTask instance
 */
const LambdaBuilder = (input: LambdaTaskInput) => {
  return new LambdaTask({ input });
};

/**
 * Convenience function to create and run a LambdaTask
 */
export const Lambda = (input: LambdaTaskInput) => {
  return LambdaBuilder(input).run();
};

// Add Lambda task builder to TaskGraphBuilder interface
declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    Lambda: TaskGraphBuilderHelper<LambdaTaskInput>;
  }
}

TaskGraphBuilder.prototype.Lambda = TaskGraphBuilderHelper(LambdaTask);

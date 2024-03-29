//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Interpreter } from "../util/interpreter";
import { SingleTask, TaskConfig, TaskOutput } from "./base/Task";
import { TaskGraphBuilder, TaskGraphBuilderHelper } from "./base/TaskGraphBuilder";
import { CreateMappedType } from "./base/TaskIOTypes";
import { TaskRegistry } from "./base/TaskRegistry";

export type JavaScriptTaskInput = CreateMappedType<typeof JavaScriptTask.inputs>;
export type JavaScriptTaskOutput = CreateMappedType<typeof JavaScriptTask.outputs>;

export class JavaScriptTask extends SingleTask {
  static readonly type = "JavaScriptTask";
  static readonly category = "Utility";
  declare runInputData: JavaScriptTaskInput;
  declare runOutputData: TaskOutput;
  public static inputs = [
    {
      id: "code",
      name: "Code",
      valueType: "text",
    },
    {
      id: "input",
      name: "Input",
      valueType: "any",
    },
  ] as const;
  public static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "any",
    },
  ] as const;
  constructor(config: TaskConfig & { input?: JavaScriptTaskInput } = {}) {
    super(config);
  }
  runSyncOnly() {
    if (this.runInputData.code) {
      try {
        const myInterpreter = new Interpreter(this.runInputData.code);
        myInterpreter.run();
        this.runOutputData.output = myInterpreter.value;
      } catch (e) {
        console.error("error", e);
      }
    }
    return this.runOutputData;
  }
}
TaskRegistry.registerTask(JavaScriptTask);

const JavaScriptBuilder = (input: JavaScriptTaskInput) => {
  return new JavaScriptTask({ input });
};

export const JavaScript = (input: JavaScriptTaskInput) => {
  return JavaScriptBuilder(input).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    JavaScript: TaskGraphBuilderHelper<JavaScriptTaskInput>;
  }
}

TaskGraphBuilder.prototype.JavaScript = TaskGraphBuilderHelper(JavaScriptTask);

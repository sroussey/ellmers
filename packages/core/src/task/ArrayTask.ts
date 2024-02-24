//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ModelFactory } from "./ModelFactory";
import { CompoundTask, TaskInput, TaskConfig, TaskOutput, TaskTypeName } from "./Task";
import { TaskInputDefinition, TaskOutputDefinition } from "./TaskIOTypes";
import { TaskRegistry } from "./TaskRegistry";

export type ConvertToArrays<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> : T[P];
};

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

function convertToArray<D extends TaskInputDefinition | TaskOutputDefinition>(io: D[], id: string) {
  const results: D[] = [];
  for (const item of io) {
    const newItem: Writeable<D> = { ...item };
    if (newItem.id === id) {
      newItem.isArray = true;
    }
    results.push(newItem);
  }
  return results as D[];
}

export function arrayTaskFactory<
  PluralInputType extends TaskInput,
  PluralOutputType extends TaskOutput,
>(taskClass: typeof ModelFactory, inputMakeArray: string, outputMakeArray: string, name?: string) {
  const inputs = convertToArray<TaskInputDefinition>(Array.from(taskClass.inputs), inputMakeArray);
  const outputs = convertToArray<TaskOutputDefinition>(
    Array.from(taskClass.outputs),
    outputMakeArray
  );

  const nameWithoutTask = taskClass.type.slice(0, -4);
  const capitalized = inputMakeArray.charAt(0).toUpperCase() + inputMakeArray.slice(1);
  name ??= nameWithoutTask + "Multi" + capitalized + "Task";

  class ArrayTask extends CompoundTask {
    static readonly displayName = name!; // this is for debuggers as they can't infer the name from code
    static readonly type: TaskTypeName = name!;
    static readonly category = taskClass.category;
    declare runInputData: PluralInputType;
    declare runOutputData: PluralOutputType;
    declare defaults: Partial<PluralInputType>;

    itemClass = taskClass;

    static inputs = inputs;
    static outputs = outputs;
    constructor(config: TaskConfig & { input?: PluralInputType } = {}) {
      super(config);
      this.generateGraph();
    }
    generateGraph() {
      if (Array.isArray(this.runInputData[inputMakeArray])) {
        this.runInputData[inputMakeArray].forEach((prop: any) => {
          const input = { ...this.runInputData, [inputMakeArray]: prop };
          const current = new taskClass({ input });
          this.subGraph.addTask(current);
        });
      }
    }
  }
  TaskRegistry.registerTask(ArrayTask);

  return ArrayTask;
}

export type ArrayTaskType = ReturnType<typeof arrayTaskFactory>;

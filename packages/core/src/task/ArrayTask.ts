//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { CompoundTask, TaskInput, TaskConfig, TaskOutput, TaskTypeName, SingleTask } from "./Task";
import { TaskGraph } from "./TaskGraph";
import { CreateMappedType, TaskInputDefinition, TaskOutputDefinition } from "./TaskIOTypes";
import { TaskRegistry } from "./TaskRegistry";

export type ConvertToArrays<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> : T[P];
};

export type ConvertAllToArrays<T> = {
  [P in keyof T]: Array<T[P]>;
};

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

function collectPropertyValues<T extends object>(input: T[]): { [K in keyof T]?: T[K][] } {
  const output: { [K in keyof T]?: T[K][] } = {};

  input.forEach((item) => {
    (Object.keys(item) as Array<keyof T>).forEach((key) => {
      const value = item[key];
      if (output[key]) {
        output[key]!.push(value);
      } else {
        output[key] = [value];
      }
    });
  });

  return output;
}

function convertToArray<D extends TaskInputDefinition | TaskOutputDefinition>(
  io: D[],
  id?: string | number | symbol
) {
  const results: D[] = [];
  for (const item of io) {
    const newItem: Writeable<D> = { ...item };
    if (newItem.id === id || id === undefined) {
      newItem.isArray = true;
    }
    results.push(newItem);
  }
  return results as D[];
}

export function arrayTaskFactory<
  PluralInputType extends TaskInput = TaskInput,
  PluralOutputType extends TaskOutput = TaskOutput,
>(
  taskClass: typeof SingleTask | typeof CompoundTask,
  inputMakeArray: keyof PluralInputType,
  name?: string
) {
  type NonPluralOutputType = CreateMappedType<typeof taskClass.inputs>;
  const inputs = convertToArray<TaskInputDefinition>(Array.from(taskClass.inputs), inputMakeArray);
  const outputs = convertToArray<TaskOutputDefinition>(Array.from(taskClass.outputs));

  const nameWithoutTask = taskClass.type.slice(0, -4);
  const ima = String(inputMakeArray);
  const capitalized = ima.charAt(0).toUpperCase() + ima.slice(1);
  name ??= nameWithoutTask + "Multi" + capitalized + "Task";

  class ArrayTask extends CompoundTask {
    static readonly displayName = name!; // this is for debuggers as they can't infer the name from code
    static readonly type: TaskTypeName = name!;
    static readonly runtype = taskClass.type;
    static readonly category = taskClass.category;
    declare runInputData: PluralInputType;
    declare runOutputData: PluralOutputType;
    declare defaults: Partial<PluralInputType>;

    itemClass = taskClass;

    static inputs = inputs;
    static override outputs = outputs;
    constructor(config: TaskConfig & { input?: Partial<PluralInputType> } = {}) {
      super(config);
      this.regenerateGraph();
    }
    regenerateGraph() {
      if (Array.isArray(this.runInputData[inputMakeArray])) {
        this.subGraph = new TaskGraph();
        this.runInputData[inputMakeArray].forEach((prop: any) => {
          const input = { ...this.runInputData, [inputMakeArray]: prop };
          const current = new taskClass({ input });
          this.subGraph.addTask(current);
        });
      }
    }
    addInputData<PluralInputType>(overrides: Partial<PluralInputType>): void {
      super.addInputData(overrides);
      this.regenerateGraph();
    }

    runSyncOnly(): PluralOutputType {
      const runDataOut = super.runSyncOnly();
      this.runOutputData = collectPropertyValues<NonPluralOutputType>(
        runDataOut.outputs
      ) as PluralOutputType;
      return this.runOutputData;
    }
    async run(): Promise<PluralOutputType> {
      const runDataOut = await super.run();
      this.runOutputData = collectPropertyValues<NonPluralOutputType>(
        runDataOut.outputs
      ) as PluralOutputType;
      return this.runOutputData;
    }
  }
  TaskRegistry.registerTask(ArrayTask);

  return ArrayTask;
}

export type ArrayTaskType = ReturnType<typeof arrayTaskFactory>;

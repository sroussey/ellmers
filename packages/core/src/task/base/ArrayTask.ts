//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { JsonTaskItem } from "../JsonTask";
import {
  CompoundTask,
  TaskInput,
  TaskConfig,
  TaskOutput,
  TaskTypeName,
  SingleTask,
  RegenerativeCompoundTask,
} from "./Task";
import { TaskGraph } from "./TaskGraph";
import { CreateMappedType, TaskInputDefinition, TaskOutputDefinition } from "./TaskIOTypes";
import { TaskRegistry } from "./TaskRegistry";

export type ConvertSomeToOptionalArray<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> | T[P] : T[P];
};

export type ConvertAllToOptionalArray<T> = {
  [P in keyof T]: Array<T[P]> | T[P];
};

export type ConvertSomeToArray<T, K extends keyof T> = {
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

function convertMultipleToArray<D extends TaskInputDefinition | TaskOutputDefinition>(
  io: D[],
  ids: Array<string | number | symbol>
) {
  const results: D[] = [];
  for (const item of io) {
    const newItem: Writeable<D> = { ...item };
    if (ids.includes(newItem.id)) {
      newItem.isArray = true;
    }
    results.push(newItem);
  }
  return results as D[];
}

function generateCombinations<T extends TaskInput>(input: T, inputMakeArray: (keyof T)[]): T[] {
  // Helper function to check if a property is an array
  const isArray = (value: any): value is Array<any> => Array.isArray(value);

  // Prepare arrays for combination generation
  const arraysToCombine: any[][] = inputMakeArray.map((key) =>
    isArray(input[key]) ? input[key] : []
  );

  // Initialize indices and combinations
  let indices = arraysToCombine.map(() => 0);
  let combinations: number[][] = [];
  let done = false;

  while (!done) {
    combinations.push([...indices]); // Add current combination of indices

    // Move to the next combination of indices
    for (let i = indices.length - 1; i >= 0; i--) {
      if (++indices[i] < arraysToCombine[i].length) break; // Increment current index if possible
      if (i === 0)
        done = true; // All combinations have been generated
      else indices[i] = 0; // Reset current index and move to the next position
    }
  }

  // Build objects based on the combinations
  return combinations.map((combination) => {
    let result = { ...input }; // Start with a shallow copy of the input

    // Set values from the arrays based on the current combination
    combination.forEach((valueIndex, arrayIndex) => {
      const key = inputMakeArray[arrayIndex];
      if (isArray(input[key])) result[key as keyof T] = input[key][valueIndex];
    });

    return result;
  });
}

export function arrayTaskFactory<
  PluralInputType extends TaskInput = TaskInput,
  PluralOutputType extends TaskOutput = TaskOutput,
>(
  taskClass: typeof SingleTask | typeof CompoundTask,
  inputMakeArray: Array<keyof PluralInputType>,
  name?: string
) {
  type NonPluralOutputType = CreateMappedType<typeof taskClass.inputs>;
  const inputs = convertMultipleToArray<TaskInputDefinition>(
    Array.from(taskClass.inputs),
    inputMakeArray
  );
  const outputs = convertToArray<TaskOutputDefinition>(Array.from(taskClass.outputs));

  const nameWithoutTask = taskClass.type.slice(0, -4);
  name ??= nameWithoutTask + "CompoundTask";

  class ArrayTask extends RegenerativeCompoundTask {
    static readonly type: TaskTypeName = name!;
    static readonly runtype = taskClass.type;
    static readonly category = taskClass.category;
    static readonly sideeffects = taskClass.sideeffects;
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
      this.subGraph = new TaskGraph();
      const combinations = generateCombinations(this.runInputData, inputMakeArray);
      combinations.forEach((input, index) => {
        const current = new taskClass({ id: this.config.id + "-child-" + (index + 1), input });
        this.subGraph.addTask(current);
      });
      super.regenerateGraph();
    }

    addInputData<PluralInputType>(overrides: Partial<PluralInputType>) {
      super.addInputData(overrides);
      this.regenerateGraph();
      return this;
    }

    runSyncOnly(): PluralOutputType {
      const runDataOut = super.runSyncOnly();
      this.runOutputData = collectPropertyValues<NonPluralOutputType>(
        runDataOut.outputs
      ) as PluralOutputType;
      return this.runOutputData;
    }
    async run(...args: any[]): Promise<PluralOutputType> {
      const runDataOut = await super.run(...args);
      this.runOutputData = collectPropertyValues<NonPluralOutputType>(
        runDataOut.outputs
      ) as PluralOutputType;
      return this.runOutputData;
    }
    toJSON(): JsonTaskItem {
      const { subgraph, ...result } = super.toJSON();
      return result;
    }
    toDependencyJSON(): JsonTaskItem {
      const { subtasks, ...result } = super.toDependencyJSON();
      return result;
    }
  }

  TaskRegistry.registerTask(ArrayTask);

  return ArrayTask;
}

export type ArrayTaskType = ReturnType<typeof arrayTaskFactory>;

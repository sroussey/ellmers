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
  TaskInputDefinition,
  TaskOutputDefinition,
} from "./Task";
import { TaskGraph } from "./TaskGraph";
import { TaskRegistry } from "./TaskRegistry";

// Type utilities for array transformations
// Makes specified properties optional arrays
export type ConvertSomeToOptionalArray<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> | T[P] : T[P];
};

// Makes all properties optional arrays
export type ConvertAllToOptionalArray<T> = {
  [P in keyof T]: Array<T[P]> | T[P];
};

// Makes specified properties required arrays
export type ConvertSomeToArray<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? Array<T[P]> : T[P];
};

// Makes all properties required arrays
export type ConvertAllToArrays<T> = {
  [P in keyof T]: Array<T[P]>;
};

// Removes readonly modifiers from object properties
type Writeable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * Takes an array of objects and collects values for each property into arrays
 * @param input Array of objects to process
 * @returns Object with arrays of values for each property
 */
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

/**
 * Converts specified IO definitions to array type
 * @param io Array of input/output definitions
 * @param id Optional ID to target specific definition
 * @returns Modified array of definitions with isArray set to true
 */
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

/**
 * Converts multiple IO definitions to array type based on provided IDs
 * @param io Array of input/output definitions
 * @param ids Array of IDs to target specific definitions
 * @returns Modified array of definitions with isArray set to true for matching IDs
 */
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

/**
 * Generates all possible combinations of array inputs
 * @param input Input object containing arrays
 * @param inputMakeArray Keys of properties to generate combinations for
 * @returns Array of input objects with all possible combinations
 */
function generateCombinations<T extends TaskInput>(input: T, inputMakeArray: (keyof T)[]): T[] {
  // Helper function to check if a property is an array
  const isArray = (value: any): value is Array<any> => Array.isArray(value);

  // Prepare arrays for combination generation
  const arraysToCombine: any[][] = inputMakeArray.map((key) =>
    isArray(input[key]) ? input[key] : []
  );

  // Initialize indices and combinations
  const indices = arraysToCombine.map(() => 0);
  const combinations: number[][] = [];
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
    const result = { ...input }; // Start with a shallow copy of the input

    // Set values from the arrays based on the current combination
    combination.forEach((valueIndex, arrayIndex) => {
      const key = inputMakeArray[arrayIndex];
      if (isArray(input[key])) result[key as keyof T] = input[key][valueIndex];
    });

    return result;
  });
}

/**
 * Factory function to create array-based task classes
 * Creates a task that can process arrays of inputs in parallel
 * @param taskClass Base task class to wrap
 * @param inputMakeArray Array of input keys to process as arrays
 * @param name Optional name for the generated task class
 * @returns New task class that handles array inputs
 */
export function arrayTaskFactory<
  PluralInputType extends TaskInput = TaskInput,
  PluralOutputType extends TaskOutput = TaskOutput,
  SingleOutputType extends TaskOutput = TaskOutput,
>(
  taskClass: typeof SingleTask | typeof CompoundTask,
  inputMakeArray: Array<keyof PluralInputType>,
  name?: string
) {
  const inputs = convertMultipleToArray<TaskInputDefinition>(
    Array.from(taskClass.inputs),
    inputMakeArray
  );
  const outputs = convertToArray<TaskOutputDefinition>(Array.from(taskClass.outputs));

  const nameWithoutTask = taskClass.type.slice(0, -4);
  name ??= nameWithoutTask + "CompoundTask";

  /**
   * A task class that handles array-based processing by creating subtasks for each combination of inputs
   * Extends RegenerativeCompoundTask to manage a collection of child tasks running in parallel
   */
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

    /**
     * Regenerates the task graph by creating child tasks for each input combination
     * Each child task processes a single combination of the array inputs
     */
    regenerateGraph() {
      this.subGraph = new TaskGraph();
      const combinations = generateCombinations(this.runInputData, inputMakeArray);
      combinations.forEach((input, index) => {
        const current = new taskClass({ id: this.config.id + "-child-" + (index + 1), input });
        this.subGraph.addTask(current);
      });
      super.regenerateGraph();
    }

    /**
     * Adds new input data and regenerates the task graph to handle the updated inputs
     * @param overrides Partial input data to merge with existing inputs
     */
    addInputData<PluralInputType>(overrides: Partial<PluralInputType>) {
      super.addInputData(overrides);
      this.regenerateGraph();
      return this;
    }

    /**
     * Runs the task reactively, collecting outputs from all child tasks into arrays
     * @returns Combined output with arrays of values from all child tasks
     */
    async runReactive(): Promise<PluralOutputType> {
      const runDataOut = await super.runReactive();
      this.runOutputData = collectPropertyValues<SingleOutputType>(
        runDataOut.outputs
      ) as PluralOutputType;
      return this.runOutputData;
    }

    /**
     * Runs the task synchronously, collecting outputs from all child tasks into arrays
     * @returns Combined output with arrays of values from all child tasks
     */
    async run(...args: any[]): Promise<PluralOutputType> {
      const runDataOut = await super.run(...args);
      this.runOutputData = collectPropertyValues<SingleOutputType>(
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

    async validateItem(valueType: string, item: any) {
      return true; // let children validate
    }
  }

  TaskRegistry.registerTask(ArrayTask);

  return ArrayTask;
}

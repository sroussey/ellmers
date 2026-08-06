/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type {
  DataPortSchema,
  DataPortSchemaNonBoolean,
  TypedArray,
  VectorFromSchema,
} from "@workglow/util/schema";

import type {
  GraphAsTaskConfig,
  GraphResultArray,
  JsonTaskItem,
  TaskGraphItemJson,
  TaskInput,
  TaskOutput,
  TaskRunContext,
} from "@workglow/task-graph";
import { GraphAsTask, GraphAsTaskRunner, PROPERTY_ARRAY, TaskGraph } from "@workglow/task-graph";

export function TypeReplicateArray<const T extends DataPortSchemaNonBoolean>(
  type: T,
  annotations: Record<string, unknown> = {}
): DataPortSchemaNonBoolean {
  return {
    oneOf: [type, { type: "array", items: type }],
    title: type.title,
    description: type.description,
    ...(type.format ? { format: type.format } : {}),
    ...annotations,
    "x-replicate": true,
  };
}

/**
 * Removes array types from a union, leaving only non-array types.
 * For example, `string | string[]` becomes `string`.
 * Used to extract the single-value type from schemas with x-replicate annotation.
 * Preserves Vector types like Float64Array which also have numeric indices.
 */
type UnwrapArrayUnion<T> = T extends readonly any[]
  ? T extends TypedArray
    ? T
    : never
  : number extends keyof T
    ? "push" extends keyof T
      ? never
      : T
    : T;

/**
 * Transforms a schema by removing array variants from properties marked with x-replicate.
 * Properties with x-replicate use {@link TypeReplicateArray} which creates a union of
 * `T | T[]`, and this type extracts just `T`.
 */
export type DeReplicateFromSchema<S extends { properties: Record<string, any> }> = {
  [K in keyof S["properties"]]: S["properties"][K] extends { "x-replicate": true }
    ? UnwrapArrayUnion<VectorFromSchema<S["properties"][K]>>
    : VectorFromSchema<S["properties"][K]>;
};

/**
 * ArrayTask is a compound task that either:
 * 1. Executes directly if all inputs are non-arrays
 * 2. Creates a subGraph with one task instance per array element if any input is an array
 * 3. Creates all combinations if multiple inputs are arrays
 */
export abstract class ArrayTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends GraphAsTaskConfig<Input> = GraphAsTaskConfig<Input>,
> extends GraphAsTask<Input, Output, Config> {
  public static override type = "ArrayTask";

  /** Make this task have results that look like an array */
  public static override readonly compoundMerge = PROPERTY_ARRAY;

  /** Reverts GraphAsTask's override so the user-defined static schema is used. */
  public override inputSchema(): DataPortSchema {
    return (this.constructor as typeof ArrayTask).inputSchema();
  }

  /** Reverts GraphAsTask's override so the user-defined static schema is used. */
  public override outputSchema(): DataPortSchema {
    return (this.constructor as typeof ArrayTask).outputSchema();
  }

  public executeMerge(_input: Input, output: Output): Output {
    return output;
  }

  public override regenerateGraph(): void {
    const arrayInputs = new Map<string, Array<Input[keyof Input]>>();
    let hasArrayInputs = false;
    const inputSchema = this.inputSchema();
    if (typeof inputSchema !== "boolean") {
      const keys = Object.keys(inputSchema.properties || {});
      for (const inputId of keys) {
        const inputValue = this.runInputData[inputId];
        const inputDef = inputSchema.properties?.[inputId];
        if (
          typeof inputDef === "object" &&
          inputDef !== null &&
          "x-replicate" in inputDef &&
          (inputDef as any)["x-replicate"] === true &&
          Array.isArray(inputValue) &&
          inputValue.length > 1
        ) {
          arrayInputs.set(inputId, inputValue);
          hasArrayInputs = true;
        }
      }
    }

    this.subGraph = new TaskGraph();

    if (!hasArrayInputs) {
      super.regenerateGraph();
      return;
    }

    const inputIds = Array.from(arrayInputs.keys());
    const inputObject = Object.fromEntries(arrayInputs);
    const combinations = this.generateCombinations(inputObject as Input, inputIds);

    const tasks = combinations.map((combination) => {
      const { id, title, ...rest } = this.config;
      const task = new (this.constructor as any)(
        {
          ...rest,
          id: `${id}_${uuid4()}`,
          defaults: { ...this.defaults, ...this.runInputData, ...combination },
        },
        this.runConfig
      );
      return task;
    });

    this.subGraph.addTasks(tasks);

    super.regenerateGraph();
  }

  /**
   * Generates all possible combinations of array inputs.
   */
  protected generateCombinations(input: Input, inputMakeArray: Array<keyof Input>): Input[] {
    const arraysToCombine: Array<Array<Input[keyof Input]>> = inputMakeArray.map((key) =>
      Array.isArray(input[key]) ? (input[key] as Array<Input[keyof Input]>) : []
    );

    const indices = new Array(arraysToCombine.length).fill(0);
    const combinations: number[][] = [];
    let done = false;

    while (!done) {
      combinations.push([...indices]);

      for (let i = indices.length - 1; i >= 0; i--) {
        if (++indices[i] < arraysToCombine[i].length) break;
        if (i === 0) done = true;
        else indices[i] = 0;
      }
    }

    const combos = combinations.map((combination) => {
      const result = { ...input };

      combination.forEach((valueIndex, arrayIndex) => {
        const key = inputMakeArray[arrayIndex];
        if (Array.isArray(input[key]))
          result[key] = (input[key] as Array<Input[keyof Input]>)[valueIndex];
      });

      return result;
    });

    return combos;
  }

  override toJSON(): TaskGraphItemJson {
    const { subgraph, ...result } = super.toJSON();
    return result;
  }

  override toDependencyJSON(): JsonTaskItem {
    const { subtasks, ...result } = super.toDependencyJSON();
    return result;
  }

  declare _runner: ArrayTaskRunner<Input, Output, Config>;

  /**
   * Custom runner for ArrayTask that overrides input passing behavior
   * as inputs were already distributed to child tasks during graph regeneration.
   */
  override get runner(): ArrayTaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new ArrayTaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }
}

/**
 * Custom runner for ArrayTask that passes empty input to child tasks.
 * ArrayTask child tasks get their input values from their defaults (set during task creation),
 * not from the parent task's input.
 */
class ArrayTaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends GraphAsTaskConfig<Input> = GraphAsTaskConfig<Input>,
> extends GraphAsTaskRunner<Input, Output, Config> {
  declare task: ArrayTask<Input, Output, Config>;

  /**
   * Pass empty input to subgraph; child tasks use defaults set during creation.
   */
  protected override async executeTaskChildren(_input: Input): Promise<GraphResultArray<Output>> {
    return super.executeTaskChildren({} as Input);
  }

  /**
   * Pass empty input to subgraph for preview execution; child tasks use defaults set during creation.
   */
  protected override async executeTaskChildrenPreview(): Promise<GraphResultArray<Output>> {
    return this.task.subGraph!.runPreview<Output>({});
  }

  public override async executeTaskPreview(
    input: Input,
    ctx: TaskRunContext
  ): Promise<Output | undefined> {
    await super.executeTaskPreview(input, ctx);
    if (this.task.hasChildren()) {
      this.task.runOutputData = this.task.executeMerge(input, this.task.runOutputData as Output);
    }
    return this.task.runOutputData as Output;
  }
  public override async executeTask(input: Input, ctx: TaskRunContext): Promise<Output> {
    await super.executeTask(input, ctx);
    if (this.task.hasChildren()) {
      this.task.runOutputData = this.task.executeMerge(input, this.task.runOutputData as Output);
    }
    return this.task.runOutputData as Output;
  }
}

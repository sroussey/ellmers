/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { CachePolicy } from "../cache/CachePolicy";
import type { IExecuteContext, ITask } from "../task/ITask";
import { Task } from "../task/Task";
import type { DataPorts } from "../task/TaskTypes";
import { DATAFLOW_ALL_PORTS } from "./Dataflow";
import type { ITaskGraph } from "./ITaskGraph";
import type { IWorkflow } from "./IWorkflow";
import { TaskGraph } from "./TaskGraph";

// ============================================================================
// Types
// ============================================================================

export type PipeFunction<I extends DataPorts = any, O extends DataPorts = any> = (
  input: I,
  context: IExecuteContext
) => O | Promise<O>;

export type Taskish<A extends DataPorts = DataPorts, B extends DataPorts = DataPorts> =
  | PipeFunction<A, B>
  | ITask<A, B>
  | ITaskGraph
  | IWorkflow<A, B>;

// ============================================================================
// GraphAsTask wrapper factory (deferred seam)
//
// `ensureTask` wraps a TaskGraph/Workflow in a GraphAsTask subclass, but
// GraphAsTask's runner depends — via TaskRunner, which imports `ensureTask` —
// back on this module: an inherent cycle. GraphAsTask.ts owns the wrapper
// subclasses (so they extend GraphAsTask directly, no casts) and registers
// this factory once it has finished evaluating; `ensureTask` calls it lazily.
// ============================================================================

export type GraphWrapperParams = {
  subGraph: TaskGraph;
  isOwned: boolean;
  isWorkflow: boolean;
  config: any;
};

export type GraphWrapperFactory = (params: GraphWrapperParams) => ITask<any, any, any>;

let _graphWrapperFactory: GraphWrapperFactory | undefined;

/** Called from {@link GraphAsTask} once its module has finished evaluating. */
export function registerGraphWrapperFactory(factory: GraphWrapperFactory): void {
  _graphWrapperFactory = factory;
}

function graphWrapperFactory(): GraphWrapperFactory {
  if (!_graphWrapperFactory) {
    throw new Error(
      "GraphAsTask is not registered yet. Ensure @workglow/task-graph has finished loading."
    );
  }
  return _graphWrapperFactory;
}

// ============================================================================
// ensureTask — converts Taskish values into ITask instances
// ============================================================================

function convertPipeFunctionToTask<I extends DataPorts, O extends DataPorts>(
  fn: PipeFunction<I, O>,
  config?: any
): ITask<I, O> {
  // Plain JS functions used inside `pipe()` cannot declare port schemas, so
  // the wrapper must accept (and emit) any object shape. The previous
  // `additionalProperties: false` (alongside a single `[DATAFLOW_ALL_PORTS]`
  // ("*") property) caused the JSON-schema validator to treat "*" as a
  // literal key and reject every real upstream port — e.g. `{ json, metadata }`
  // from `FetchUrlTask` — breaking any `pipe(task, async fn, ...)` chain with
  // TaskInvalidInputError. The runtime already handles the "*" wildcard in
  // `Task.addInput`; the schema just needs to permit the data through.
  class QuickTask extends Task<I, O> {
    public static override type = fn.name ? `𝑓 ${fn.name}` : "𝑓";
    public static override inputSchema = () => {
      return {
        type: "object",
        properties: {
          [DATAFLOW_ALL_PORTS]: {},
        },
        additionalProperties: true,
      } as const satisfies DataPortSchema;
    };
    public static override outputSchema = () => {
      return {
        type: "object",
        properties: {
          [DATAFLOW_ALL_PORTS]: {},
        },
        additionalProperties: true,
      } as const satisfies DataPortSchema;
    };
    public static override cachePolicy: CachePolicy = { kind: "none" };
    public override async execute(input: I, context: IExecuteContext) {
      return fn(input, context);
    }
  }
  return new QuickTask(config);
}

/**
 * Checks if a value implements the IWorkflow interface (has a `graph` property
 * that is a TaskGraph and a `run` method). Used instead of `instanceof Workflow`
 * to avoid a circular dependency with the Workflow module.
 */
function isWorkflowLike(arg: unknown): arg is IWorkflow {
  return (
    arg != null &&
    typeof arg === "object" &&
    "graph" in arg &&
    arg.graph instanceof TaskGraph &&
    "run" in arg &&
    typeof arg.run === "function"
  );
}

export function ensureTask<I extends DataPorts, O extends DataPorts>(
  arg: Taskish<I, O>,
  config: any = {}
): ITask<any, any, any> {
  if (arg instanceof Task) {
    return arg;
  }
  if (arg instanceof TaskGraph) {
    const { isOwned, ...cleanConfig } = config;
    return graphWrapperFactory()({
      subGraph: arg,
      isOwned: Boolean(isOwned),
      isWorkflow: false,
      config: cleanConfig,
    });
  }
  if (isWorkflowLike(arg)) {
    const { isOwned, ...cleanConfig } = config;
    return graphWrapperFactory()({
      subGraph: arg.graph,
      isOwned: Boolean(isOwned),
      isWorkflow: true,
      config: cleanConfig,
    });
  }
  return convertPipeFunctionToTask(arg as PipeFunction<I, O>, config);
}

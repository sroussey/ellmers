/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { CachePolicy } from "../cache/CachePolicy";
import { GraphAsTask } from "../task/GraphAsTask";
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
// Wrapper classes (lazily initialized so GraphAsTask is not needed until
// ensureTask wraps a graph/workflow; GraphAsTask imports TaskGraph, which
// imports this module — deferring construction avoids init-order issues)
// ============================================================================

type GraphAsTaskConstructor = typeof GraphAsTask;

let _OwnGraphTask: GraphAsTaskConstructor;
let _OwnWorkflowTask: GraphAsTaskConstructor;
let _GraphTask: GraphAsTaskConstructor;
let _ConvWorkflowTask: GraphAsTaskConstructor;

function getWrapperClasses() {
  if (!_OwnGraphTask) {
    class ListeningGraphAsTask extends GraphAsTask<any, any> {
      constructor(config: any) {
        super(config);
        this.subGraph.on("start", () => {
          this.emit("start");
        });
        this.subGraph.on("complete", () => {
          this.emit("complete");
        });
        this.subGraph.on("error", (e) => {
          this.emit("error", e);
        });
      }
    }

    class OwnGraphTask extends ListeningGraphAsTask {
      public static override readonly type = "Own[Graph]";
    }

    class OwnWorkflowTask extends ListeningGraphAsTask {
      public static override readonly type = "Own[Workflow]";
    }

    class GraphTask extends GraphAsTask {
      public static override readonly type = "Graph";
    }

    class ConvWorkflowTask extends GraphAsTask {
      public static override readonly type = "Workflow";
    }

    _OwnGraphTask = OwnGraphTask as unknown as GraphAsTaskConstructor;
    _OwnWorkflowTask = OwnWorkflowTask as unknown as GraphAsTaskConstructor;
    _GraphTask = GraphTask as unknown as GraphAsTaskConstructor;
    _ConvWorkflowTask = ConvWorkflowTask as unknown as GraphAsTaskConstructor;
  }
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
    getWrapperClasses();
    const { isOwned, ...cleanConfig } = config;
    if (isOwned) {
      return new _OwnGraphTask({ ...cleanConfig, subGraph: arg });
    } else {
      return new _GraphTask({ ...cleanConfig, subGraph: arg });
    }
  }
  if (isWorkflowLike(arg)) {
    getWrapperClasses();
    const { isOwned, ...cleanConfig } = config;
    if (isOwned) {
      return new _OwnWorkflowTask({ ...cleanConfig, subGraph: arg.graph });
    } else {
      return new _ConvWorkflowTask({ ...cleanConfig, subGraph: arg.graph });
    }
  }
  return convertPipeFunctionToTask(arg as PipeFunction<I, O>, config);
}

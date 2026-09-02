/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ITask } from "../task/ITask";
import { Task } from "../task/Task";
import { TaskConfigurationError } from "../task/TaskError";
import type { DataPorts } from "../task/TaskTypes";
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
// Pipe-function wrapper factory (deferred seam)
//
// Same cycle as above, and the same remedy. `Task.ts` imports `TaskRunner`,
// which imports this module, so by the time this module is evaluated `Task` is
// still uninitialized. A method body that merely *reads* `Task` later is fine
// (the binding is live by then — `ensureTask`'s `instanceof` below relies on
// that), but a `class ... extends Task` clause is not: it resolves the
// superclass against the binding as it stood when the module was evaluated,
// and throws "Class extends value undefined". PipeFunctionTask.ts owns the
// wrapper subclass and registers this factory once it has finished evaluating.
// ============================================================================

export type PipeWrapperFactory = <I extends DataPorts, O extends DataPorts>(
  fn: PipeFunction<I, O>,
  config: any
) => ITask<I, O>;

let _pipeWrapperFactory: PipeWrapperFactory | undefined;

/** Called from {@link PipeFunctionTask} once its module has finished evaluating. */
export function registerPipeWrapperFactory(factory: PipeWrapperFactory): void {
  _pipeWrapperFactory = factory;
}

function pipeWrapperFactory(): PipeWrapperFactory {
  if (!_pipeWrapperFactory) {
    throw new Error(
      "PipeFunctionTask is not registered yet. Ensure @workglow/task-graph has finished loading."
    );
  }
  return _pipeWrapperFactory;
}

// ============================================================================
// ensureTask — converts Taskish values into ITask instances
// ============================================================================

function convertPipeFunctionToTask<I extends DataPorts, O extends DataPorts>(
  fn: PipeFunction<I, O>,
  config?: any
): ITask<I, O> {
  return pipeWrapperFactory()(fn, config);
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
  // `isOwned` is a wrapper-construction flag, not task config: every branch
  // below has to keep it out of the config it forwards, or `Task`'s config
  // validation rejects the unknown property.
  const { isOwned, ...cleanConfig } = config ?? {};
  if (arg instanceof Task) {
    // Only the branches below *construct* a task, so only they have somewhere
    // to put a config. An instance arrives already built and validated against
    // its own `configSchema()`, and merging into it afterwards would skip that
    // validation, desync the frozen `originalConfig` that `toJSON` reads, and —
    // for `id` — rename a node the DAG has already keyed. So it cannot be
    // honored; say so instead of dropping it. `own()` and `addTask()` type this
    // out of reach, but both are reachable through a cast.
    const ignored = Object.keys(cleanConfig);
    if (ignored.length > 0) {
      throw new TaskConfigurationError(
        `ensureTask(): ${arg.type} is already a task, so config (${ignored.join(", ")}) cannot be applied. ` +
          `Pass it to the constructor, or use setTitle() to relabel a reused instance.`
      );
    }
    return arg;
  }
  if (arg instanceof TaskGraph) {
    return graphWrapperFactory()({
      subGraph: arg,
      isOwned: Boolean(isOwned),
      isWorkflow: false,
      config: cleanConfig,
    });
  }
  if (isWorkflowLike(arg)) {
    return graphWrapperFactory()({
      subGraph: arg.graph,
      isOwned: Boolean(isOwned),
      isWorkflow: true,
      config: cleanConfig,
    });
  }
  return convertPipeFunctionToTask(arg as PipeFunction<I, O>, cleanConfig);
}

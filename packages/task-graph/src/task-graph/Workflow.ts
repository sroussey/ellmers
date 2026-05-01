/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import { EventEmitter, getLogger, ServiceRegistry, uuid4 } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { JsonSchema } from "@workglow/util/schema";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ConditionFn } from "../task/ConditionalTask";
import { GraphAsTask } from "../task/GraphAsTask";
import type { ITask, ITaskConstructor } from "../task/ITask";
import type { StreamEvent } from "../task/StreamTypes";
import { Task } from "../task/Task";
import type { TaskEntitlements } from "../task/TaskEntitlements";
import { WorkflowError } from "../task/TaskError";
import type { JsonTaskItem, TaskGraphJson, TaskGraphJsonOptions } from "../task/TaskJSON";
import type { DataPorts, TaskConfig, TaskIdType, TaskInput } from "../task/TaskTypes";
import { autoConnect } from "./autoConnect";
import { ConditionalBuilder } from "./ConditionalBuilder";
import type { PipeFunction, Taskish } from "./Conversions";
import { ensureTask } from "./Conversions";
import { Dataflow, DATAFLOW_ALL_PORTS, DATAFLOW_ERROR_PORT } from "./Dataflow";
import type { GraphEntitlementOptions } from "./GraphEntitlementUtils";
import { computeGraphEntitlements } from "./GraphEntitlementUtils";
import type { ITaskGraph } from "./ITaskGraph";
import type { IWorkflow, WorkflowRunConfig } from "./IWorkflow";
import { TaskGraph } from "./TaskGraph";
import type { PropertyArrayGraphResult } from "./TaskGraphRunner";
import { CompoundMergeStrategy, PROPERTY_ARRAY } from "./TaskGraphRunner";
import type { ITransformStep } from "./TransformTypes";

// ============================================================================
// Standalone utility functions (moved from Conversions.ts to break circular
// dependency — these need both Workflow and GraphAsTask which live here)
// ============================================================================

export function getLastTask(workflow: IWorkflow): ITask<any, any, any> | undefined {
  const tasks = workflow.graph.getTasks();
  return tasks.length > 0 ? tasks[tasks.length - 1] : undefined;
}

export function connect(
  source: ITask<any, any, any>,
  target: ITask<any, any, any>,
  workflow: IWorkflow<any, any>
): void {
  workflow.graph.addDataflow(new Dataflow(source.id, "*", target.id, "*"));
}

export function pipe<A extends DataPorts, B extends DataPorts>(
  [fn1]: [Taskish<A, B>],
  workflow?: IWorkflow<A, B>
): IWorkflow<A, B>;

export function pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts>(
  [fn1, fn2]: [Taskish<A, B>, Taskish<B, C>],
  workflow?: IWorkflow<A, C>
): IWorkflow<A, C>;

export function pipe<
  A extends DataPorts,
  B extends DataPorts,
  C extends DataPorts,
  D extends DataPorts,
>(
  [fn1, fn2, fn3]: [Taskish<A, B>, Taskish<B, C>, Taskish<C, D>],
  workflow?: IWorkflow<A, D>
): IWorkflow<A, D>;

export function pipe<
  A extends DataPorts,
  B extends DataPorts,
  C extends DataPorts,
  D extends DataPorts,
  E extends DataPorts,
>(
  [fn1, fn2, fn3, fn4]: [Taskish<A, B>, Taskish<B, C>, Taskish<C, D>, Taskish<D, E>],
  workflow?: IWorkflow<A, E>
): IWorkflow<A, E>;

export function pipe<
  A extends DataPorts,
  B extends DataPorts,
  C extends DataPorts,
  D extends DataPorts,
  E extends DataPorts,
  F extends DataPorts,
>(
  [fn1, fn2, fn3, fn4, fn5]: [
    Taskish<A, B>,
    Taskish<B, C>,
    Taskish<C, D>,
    Taskish<D, E>,
    Taskish<E, F>,
  ],
  workflow?: IWorkflow<A, F>
): IWorkflow<A, F>;

export function pipe<I extends DataPorts, O extends DataPorts>(
  args: Taskish<I, O>[],
  workflow: IWorkflow<I, O> = new Workflow<I, O>()
): IWorkflow<I, O> {
  let previousTask = getLastTask(workflow);
  const tasks = args.map((arg) => ensureTask(arg));
  tasks.forEach((task) => {
    workflow.graph.addTask(task);
    if (previousTask) {
      connect(previousTask, task, workflow);
    }
    previousTask = task;
  });
  return workflow;
}

/** Options accepted by {@link Workflow.rename}. */
export interface RenameOptions {
  /** Index of the task whose output is renamed (defaults to the last task, `-1`). */
  readonly index?: number;
  /** Transform chain applied to the dataflow edge this rename creates. */
  readonly transforms?: ReadonlyArray<ITransformStep>;
}

export function parallel<I extends DataPorts = DataPorts, O extends DataPorts = DataPorts>(
  args: (PipeFunction<I, O> | ITask<I, O> | IWorkflow<I, O> | ITaskGraph)[],
  mergeFn: CompoundMergeStrategy = PROPERTY_ARRAY,
  workflow: IWorkflow<I, O> = new Workflow<I, O>()
): IWorkflow<I, O> {
  let previousTask = getLastTask(workflow);
  const tasks = args.map((arg) => ensureTask(arg));
  const config = {
    compoundMerge: mergeFn,
  };
  const name = `‖${args.map((_arg) => "𝑓").join("‖")}‖`;
  class ParallelTask extends GraphAsTask<I, O> {
    public static override type = name;
  }
  const mergeTask = new ParallelTask(config);
  mergeTask.subGraph!.addTasks(tasks);
  workflow.graph.addTask(mergeTask);
  if (previousTask) {
    connect(previousTask, mergeTask, workflow);
  }
  return workflow;
}

// Type definitions for the workflow
export type CreateWorkflow<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I>> = (
  input?: Partial<I>,
  config?: Partial<C>
) => Workflow<I, O>;

export function CreateWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig<I> = TaskConfig<I>,
>(taskClass: ITaskConstructor<I, O, C>): CreateWorkflow<I, O, C> {
  return Workflow.createWorkflow<I, O, C>(taskClass);
}

/**
 * Type for loop workflow methods (map, while, reduce).
 * Represents the method signature with proper `this` context.
 * Loop methods take only a config parameter - input is not used for loop tasks.
 */
export type CreateLoopWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig<I> = TaskConfig<I>,
> = (this: Workflow<I, O>, config?: Partial<C>) => Workflow<I, O>;

/**
 * Factory function that creates a loop workflow method for a given task class.
 * Returns a method that can be assigned to Workflow.prototype.
 *
 * @param taskClass - The iterator task class (MapTask, ReduceTask, etc.)
 * @returns A method that creates the task and returns a loop builder workflow
 */
export function CreateLoopWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig<I> = TaskConfig<I>,
>(taskClass: ITaskConstructor<I, O, C>): CreateLoopWorkflow<I, O, C> {
  return function (this: Workflow<I, O>, config: Partial<C> = {}): Workflow<I, O> {
    return this.addLoopTask(taskClass, config);
  };
}

/**
 * Type for end loop workflow methods (endMap, endBatch, etc.).
 */
export type EndLoopWorkflow = (this: Workflow) => Workflow;

/**
 * Factory function that creates an end loop workflow method.
 *
 * @param methodName - The name of the method (for error messages)
 * @returns A method that finalizes the loop and returns to the parent workflow
 */
export function CreateEndLoopWorkflow(methodName: string): EndLoopWorkflow {
  return function (this: Workflow): Workflow {
    if (!this.isLoopBuilder) {
      throw new Error(`${methodName}() can only be called on loop workflows`);
    }
    return this.finalizeAndReturn();
  };
}

const TYPED_ARRAY_FORMAT_PREFIX = "TypedArray";

/**
 * Returns true if the given JSON schema (or any nested schema) has a format
 * string starting with "TypedArray" (e.g. "TypedArray" or "TypedArray:Float32Array").
 * Walks oneOf/anyOf wrappers and array items.
 */
function schemaHasTypedArrayFormat(schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return false;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;

  const s = schema as Record<string, unknown>;
  if (typeof s.format === "string" && s.format.startsWith(TYPED_ARRAY_FORMAT_PREFIX)) {
    return true;
  }

  const checkUnion = (schemas: unknown): boolean => {
    if (!Array.isArray(schemas)) return false;
    return schemas.some((sub) => schemaHasTypedArrayFormat(sub as JsonSchema));
  };
  if (checkUnion(s.oneOf) || checkUnion(s.anyOf)) return true;

  const items = s.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    if (schemaHasTypedArrayFormat(items as JsonSchema)) return true;
  }

  return false;
}

/**
 * Returns true if the task's output schema has any port with TypedArray format.
 * Used by adaptive workflow methods to choose scalar vs vector task variant.
 */
export function hasVectorOutput(task: ITask): boolean {
  const outputSchema = task.outputSchema();
  if (typeof outputSchema === "boolean" || !outputSchema?.properties) return false;
  return Object.values(outputSchema.properties).some((prop) =>
    schemaHasTypedArrayFormat(prop as JsonSchema)
  );
}

/**
 * Returns true if the input object looks like vector task input: has a "vectors"
 * property that is an array with at least one TypedArray element. Used by
 * adaptive workflow methods so that e.g. sum({ vectors: [new Float32Array(...)] })
 * chooses the vector variant even with no previous task.
 */
export function hasVectorLikeInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const v = (input as Record<string, unknown>).vectors;
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "object" &&
    v[0] !== null &&
    ArrayBuffer.isView(v[0])
  );
}

/**
 * Type for adaptive workflow methods that dispatch to scalar or vector variant
 * based on the previous task's output schema.
 */
export type CreateAdaptiveWorkflow<
  IS extends DataPorts,
  _OS extends DataPorts,
  IV extends DataPorts,
  _OV extends DataPorts,
  CS extends TaskConfig<IS> = TaskConfig<IS>,
  CV extends TaskConfig<IV> = TaskConfig<IV>,
> = (
  this: Workflow,
  input?: Partial<IS> & Partial<IV>,
  config?: Partial<CS> & Partial<CV>
) => Workflow;

/**
 * Factory that creates an adaptive workflow method: when called, inspects the
 * output schema of the last task in the chain and delegates to the vector
 * variant if it has TypedArray output, otherwise to the scalar variant.
 * If there is no previous task, defaults to the scalar variant.
 *
 * @param scalarClass - Task class for scalar path (e.g. ScalarAddTask)
 * @param vectorClass - Task class for vector path (e.g. VectorSumTask)
 * @returns A method suitable for Workflow.prototype
 */
export function CreateAdaptiveWorkflow<
  IS extends DataPorts,
  OS extends DataPorts,
  IV extends DataPorts,
  OV extends DataPorts,
  CS extends TaskConfig<IS> = TaskConfig<IS>,
  CV extends TaskConfig<IV> = TaskConfig<IV>,
>(
  scalarClass: ITaskConstructor<IS, OS, CS>,
  vectorClass: ITaskConstructor<IV, OV, CV>
): CreateAdaptiveWorkflow<IS, OS, IV, OV, CS, CV> {
  const scalarHelper = Workflow.createWorkflow<IS, OS, CS>(scalarClass);
  const vectorHelper = Workflow.createWorkflow<IV, OV, CV>(vectorClass);

  return function (
    this: Workflow<any, any>,
    input: (Partial<IS> & Partial<IV>) | undefined = {},
    config: (Partial<CS> & Partial<CV>) | undefined = {}
  ): Workflow {
    const parent = getLastTask(this);
    const useVector =
      (parent !== undefined && hasVectorOutput(parent)) || hasVectorLikeInput(input);
    if (useVector) {
      return vectorHelper.call(this, input, config) as Workflow;
    }
    return scalarHelper.call(this, input, config) as Workflow;
  };
}

// Event types
export type WorkflowEventListeners = {
  changed: (id: unknown) => void;
  reset: () => void;
  error: (error: string) => void;
  start: () => void;
  complete: () => void;
  abort: (error: string) => void;
  /** Fired when a task in the workflow starts streaming */
  stream_start: (taskId: TaskIdType) => void;
  /** Fired for each stream chunk produced by a task in the workflow */
  stream_chunk: (taskId: TaskIdType, event: StreamEvent) => void;
  /** Fired when a task in the workflow finishes streaming */
  stream_end: (taskId: TaskIdType, output: Record<string, any>) => void;
  /** Fired when the aggregated entitlements of the workflow change */
  entitlementChange: (entitlements: TaskEntitlements) => void;
};

export type WorkflowEvents = keyof WorkflowEventListeners;
export type WorkflowEventListener<Event extends WorkflowEvents> = WorkflowEventListeners[Event];
export type WorkflowEventParameters<Event extends WorkflowEvents> = EventParameters<
  WorkflowEventListeners,
  Event
>;

class WorkflowTask<I extends DataPorts, O extends DataPorts> extends GraphAsTask<I, O> {
  public static override readonly type = "Workflow";
  public static override readonly compoundMerge = PROPERTY_ARRAY as CompoundMergeStrategy;
}

/**
 * Class for building and managing a task graph
 * Provides methods for adding tasks, connecting outputs to inputs, and running the task graph
 *
 * When used with a parent workflow (loop builder mode), this class redirects task additions
 * to the iterator task's template graph until an end method (endMap, endBatch, etc.) is called.
 */
export class Workflow<
  Input extends DataPorts = DataPorts,
  Output extends DataPorts = DataPorts,
> implements IWorkflow<Input, Output> {
  /**
   * Creates a new Workflow
   *
   * @param cache - Optional repository for task outputs
   * @param parent - Optional parent workflow (for loop builder mode)
   * @param iteratorTask - Optional iterator task being configured (for loop builder mode)
   * @param registry - Optional service registry to use for this workflow run
   * @returns A new Workflow instance
   */
  constructor(
    cache?: TaskOutputRepository,
    parent?: Workflow,
    iteratorTask?: GraphAsTask,
    registry?: ServiceRegistry
  ) {
    this._outputCache = cache;
    this._parentWorkflow = parent;
    this._iteratorTask = iteratorTask;
    this._registry = registry ?? parent?._registry;
    this._graph = new TaskGraph({ outputCache: this._outputCache });

    if (!parent) {
      this._onChanged = this._onChanged.bind(this);
      this.setupEvents();
    }
  }

  // Private properties
  private _graph: TaskGraph;
  private _dataFlows: Dataflow[] = [];
  private _error: string = "";
  private _outputCache?: TaskOutputRepository;
  private _registry?: ServiceRegistry;
  private _entitlementUnsub?: () => void;

  // Abort controller for cancelling task execution
  private _abortController?: AbortController;

  // Loop builder properties
  private readonly _parentWorkflow?: Workflow;
  private readonly _iteratorTask?: GraphAsTask;
  private _pendingLoopConnect?: {
    parent: ITask;
    iteratorTask: ITask;
  };

  public outputCache(): TaskOutputRepository | undefined {
    return this._outputCache;
  }

  /**
   * Whether this workflow is in loop builder mode.
   * When true, tasks are added to the template graph for an iterator task.
   */
  public get isLoopBuilder(): boolean {
    return this._parentWorkflow !== undefined;
  }

  /**
   * Event emitter for task graph events
   */
  public readonly events = new EventEmitter<WorkflowEventListeners>();

  /**
   * Creates a helper function for adding specific task types to a Workflow
   *
   * @param taskClass - The task class to create a helper for
   * @returns A function that adds the specified task type to a Workflow
   */
  public static createWorkflow<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(taskClass: ITaskConstructor<I, O, C>): CreateWorkflow<I, O, C> {
    const helper = function (
      this: Workflow<any, any>,
      input: Partial<I> = {},
      config: Partial<C> = {}
    ) {
      this._error = "";

      const parent = getLastTask(this);

      const task = this.addTaskToGraph<I, O, C>(taskClass, {
        id: uuid4(),
        ...config,
        defaults: input,
      } as C);

      // Process any pending data flows
      if (this._dataFlows.length > 0) {
        this._dataFlows.forEach((dataflow) => {
          const taskSchema = task.inputSchema();
          if (
            (typeof taskSchema !== "boolean" &&
              taskSchema.properties?.[dataflow.targetTaskPortId] === undefined &&
              taskSchema.additionalProperties !== true) ||
            (taskSchema === true && dataflow.targetTaskPortId !== DATAFLOW_ALL_PORTS)
          ) {
            this._error = `Input ${dataflow.targetTaskPortId} not found on task ${task.id}`;
            getLogger().error(this._error);
            return;
          }

          dataflow.targetTaskId = task.id;
          this.graph.addDataflow(dataflow);
        });

        this._dataFlows = [];
      }

      // Auto-connect to parent if needed
      if (parent) {
        // Build the list of earlier tasks (in reverse chronological order)
        const nodes = this._graph.getTasks();
        const parentIndex = nodes.findIndex((n) => n.id === parent.id);
        const earlierTasks: ITask[] = [];
        for (let i = parentIndex - 1; i >= 0; i--) {
          earlierTasks.push(nodes[i]);
        }

        const providedInputKeys = new Set(Object.keys(input || {}));

        // Ports already connected via pending dataflows (e.g., from .rename())
        // must not be re-matched by auto-connect Strategies 1/2/3.
        const connectedInputKeys = new Set(
          this.graph.getSourceDataflows(task.id).map((df) => df.targetTaskPortId)
        );

        const result = Workflow.autoConnect(this.graph, parent, task, {
          providedInputKeys,
          connectedInputKeys,
          earlierTasks,
        });

        if (result.error) {
          // In loop builder mode, don't remove the task - allow manual connection
          // In normal mode, remove the task since auto-connect is required
          if (this.isLoopBuilder) {
            this._error = result.error;
            getLogger().warn(this._error);
          } else {
            this._error = result.error + " Task not added.";
            getLogger().error(this._error);
            this.graph.removeTask(task.id);
          }
        }
      }

      // Update InputTask/OutputTask schemas based on connected dataflows
      if (!this._error) {
        Workflow.updateBoundaryTaskSchemas(this._graph);
      }

      // Preserve input type from the start of the chain
      // If this is the first task, set both input and output types
      // Otherwise, only update the output type (input type is preserved from 'this')
      return this as any;
    };

    // Copy metadata from the task class
    helper.type = (taskClass as unknown as { runtype?: string }).runtype ?? taskClass.type;
    helper.category = taskClass.category;
    helper.inputSchema = taskClass.inputSchema;
    helper.outputSchema = taskClass.outputSchema;
    helper.cacheable = taskClass.cacheable;
    helper.workflowCreate = true;

    return helper as CreateWorkflow<I, O, C>;
  }

  /**
   * Gets the current task graph
   */
  public get graph(): TaskGraph {
    return this._graph;
  }

  /**
   * Sets a new task graph
   */
  public set graph(value: TaskGraph) {
    this._dataFlows = [];
    this._error = "";
    this.clearEvents();
    this._graph = value;
    this.setupEvents();
    this.events.emit("reset");
  }

  /**
   * Gets the current error message
   */
  public get error(): string {
    return this._error;
  }

  /**
   * Event subscription methods
   */
  public on<Event extends WorkflowEvents>(name: Event, fn: WorkflowEventListener<Event>): void {
    this.events.on(name, fn);
  }

  public off<Event extends WorkflowEvents>(name: Event, fn: WorkflowEventListener<Event>): void {
    this.events.off(name, fn);
  }

  public once<Event extends WorkflowEvents>(name: Event, fn: WorkflowEventListener<Event>): void {
    this.events.once(name, fn);
  }

  public waitOn<Event extends WorkflowEvents>(
    name: Event
  ): Promise<WorkflowEventParameters<Event>> {
    return this.events.waitOn(name) as Promise<WorkflowEventParameters<Event>>;
  }

  /**
   * Runs the task graph
   *
   * @param input - The input to the task graph
   * @param config - Optional configuration for the workflow run
   * @returns The output of the task graph
   */
  public async run(
    input: Partial<Input> = {},
    config?: WorkflowRunConfig
  ): Promise<PropertyArrayGraphResult<Output>> {
    // In loop builder mode, finalize template and delegate to parent
    if (this.isLoopBuilder) {
      this.finalizeTemplate();
      // Run deferred auto-connect now that template graph is populated
      if (this._pendingLoopConnect) {
        this._parentWorkflow!.autoConnectLoopTask(this._pendingLoopConnect);
        this._pendingLoopConnect = undefined;
      }
      return this._parentWorkflow!.run(input as any, config) as Promise<
        PropertyArrayGraphResult<Output>
      >;
    }

    this.events.emit("start");
    this._abortController = new AbortController();

    // Subscribe to graph-level streaming events and forward to workflow events
    const unsubStreaming = this.graph.subscribeToTaskStreaming({
      onStreamStart: (taskId) => this.events.emit("stream_start", taskId),
      onStreamChunk: (taskId, event) => this.events.emit("stream_chunk", taskId, event),
      onStreamEnd: (taskId, output) => this.events.emit("stream_end", taskId, output),
    });

    try {
      const output = await this.graph.run<Output>(input, {
        parentSignal: this._abortController.signal,
        outputCache: this._outputCache,
        registry: config?.registry ?? this._registry,
        resourceScope: config?.resourceScope,
      });
      const results = this.graph.mergeExecuteOutputsToRunOutput<Output, typeof PROPERTY_ARRAY>(
        output,
        PROPERTY_ARRAY
      );
      this.events.emit("complete");
      return results;
    } catch (error) {
      this.events.emit("error", String(error));
      throw error;
    } finally {
      unsubStreaming();
      this._abortController = undefined;
    }
  }

  /**
   * Aborts the running task graph
   */
  public async abort(): Promise<void> {
    // In loop builder mode, delegate to parent
    if (this._parentWorkflow) {
      return this._parentWorkflow.abort();
    }
    this._abortController?.abort();
  }

  /**
   * Removes the last task from the task graph
   *
   * @returns The current task graph workflow
   */
  public pop(): Workflow {
    this._error = "";
    const nodes = this._graph.getTasks();

    if (nodes.length === 0) {
      this._error = "No tasks to remove";
      getLogger().error(this._error);
      return this;
    }

    const lastNode = nodes[nodes.length - 1];
    this._graph.removeTask(lastNode.id);
    return this;
  }

  /**
   * Converts the task graph to JSON
   *
   * @param options Options controlling serialization (e.g., boundary nodes)
   * @returns The task graph as JSON
   */
  public toJSON(options: TaskGraphJsonOptions = { withBoundaryNodes: true }): TaskGraphJson {
    return this._graph.toJSON(options);
  }

  /**
   * Converts the task graph to dependency JSON
   *
   * @param options Options controlling serialization (e.g., boundary nodes)
   * @returns The task graph as dependency JSON
   */
  public toDependencyJSON(
    options: TaskGraphJsonOptions = { withBoundaryNodes: true }
  ): JsonTaskItem[] {
    return this._graph.toDependencyJSON(options);
  }

  /**
   * Returns the aggregated entitlements required by all tasks in this workflow.
   * @param options Options for controlling aggregation (e.g., conditional branch handling)
   */
  public entitlements(options?: GraphEntitlementOptions): TaskEntitlements {
    return computeGraphEntitlements(this._graph, options);
  }

  // Replace both the instance and static pipe methods with properly typed versions
  // Pipe method overloads
  public pipe<A extends DataPorts, B extends DataPorts>(fn1: Taskish<A, B>): IWorkflow<A, B>;
  public pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts>(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>
  ): IWorkflow<A, C>;
  public pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts, D extends DataPorts>(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>,
    fn3: Taskish<C, D>
  ): IWorkflow<A, D>;
  public pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
  >(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>,
    fn3: Taskish<C, D>,
    fn4: Taskish<D, E>
  ): IWorkflow<A, E>;
  public pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
    F extends DataPorts,
  >(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>,
    fn3: Taskish<C, D>,
    fn4: Taskish<D, E>,
    fn5: Taskish<E, F>
  ): IWorkflow<A, F>;
  public pipe(...args: Taskish<DataPorts, DataPorts>[]): IWorkflow {
    return pipe(args as any, this);
  }

  // Static pipe method overloads
  public static pipe<A extends DataPorts, B extends DataPorts>(
    fn1: PipeFunction<A, B> | ITask<A, B>
  ): IWorkflow;
  public static pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts>(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>
  ): IWorkflow;
  public static pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
  >(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>,
    fn3: PipeFunction<C, D> | ITask<C, D>
  ): IWorkflow;
  public static pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
  >(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>,
    fn3: PipeFunction<C, D> | ITask<C, D>,
    fn4: PipeFunction<D, E> | ITask<D, E>
  ): IWorkflow;
  public static pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
    F extends DataPorts,
  >(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>,
    fn3: PipeFunction<C, D> | ITask<C, D>,
    fn4: PipeFunction<D, E> | ITask<D, E>,
    fn5: PipeFunction<E, F> | ITask<E, F>
  ): IWorkflow;
  public static pipe(...args: (PipeFunction | ITask)[]): IWorkflow {
    return pipe(args as any, new Workflow());
  }

  public parallel(
    args: (PipeFunction<any, any> | Task)[],
    mergeFn?: CompoundMergeStrategy
  ): IWorkflow {
    return parallel(args, mergeFn ?? PROPERTY_ARRAY, this);
  }

  public static parallel(
    args: (PipeFunction<any, any> | ITask)[],
    mergeFn?: CompoundMergeStrategy
  ): IWorkflow {
    return parallel(args, mergeFn ?? PROPERTY_ARRAY, new Workflow());
  }

  /**
   * Renames an output of a task to a new target input.
   *
   * @param source - The id of the output to rename
   * @param target - The id of the input to rename to
   * @param indexOrOptions - Either the numeric task index (defaults to `-1`,
   *   the last task) or a {@link RenameOptions} bag with `index` and/or
   *   `transforms` to apply to the pending dataflow.
   * @returns The current task graph workflow
   */
  public rename(source: string, target: string, index?: number): Workflow;
  public rename(source: string, target: string, options: RenameOptions): Workflow;
  public rename(
    source: string,
    target: string,
    indexOrOptions: number | RenameOptions = -1
  ): Workflow {
    this._error = "";

    const index =
      typeof indexOrOptions === "number" ? indexOrOptions : (indexOrOptions.index ?? -1);
    const transforms = typeof indexOrOptions === "number" ? undefined : indexOrOptions.transforms;

    const nodes = this._graph.getTasks();
    if (-index > nodes.length) {
      const errorMsg = `Back index greater than number of tasks`;
      this._error = errorMsg;
      getLogger().error(this._error);
      throw new WorkflowError(errorMsg);
    }

    const lastNode = nodes[nodes.length + index];
    const outputSchema = lastNode.outputSchema();

    // Handle boolean schemas
    if (typeof outputSchema === "boolean") {
      if (outputSchema === false && source !== DATAFLOW_ALL_PORTS) {
        const errorMsg = `Task ${lastNode.id} has schema 'false' and outputs nothing`;
        this._error = errorMsg;
        getLogger().error(this._error);
        throw new WorkflowError(errorMsg);
      }
      // If outputSchema is true, we skip validation as it outputs everything
    } else if (!(outputSchema.properties as any)?.[source] && source !== DATAFLOW_ALL_PORTS) {
      const errorMsg = `Output ${source} not found on task ${lastNode.id}`;
      this._error = errorMsg;
      getLogger().error(this._error);
      throw new WorkflowError(errorMsg);
    }

    const df = new Dataflow(lastNode.id, source, undefined, target);
    if (transforms && transforms.length > 0) df.setTransforms(transforms);
    this._dataFlows.push(df);
    return this;
  }

  /**
   * Adds an error handler task that receives errors from the previous task.
   *
   * When the previous task fails, instead of failing the entire workflow, the
   * error is routed to the handler task via the `[error]` output port. The
   * handler task receives `{ error, errorType }` as input and can produce
   * output that flows to subsequent tasks in the pipeline.
   *
   * @param handler - A task, task class, or pipe function to handle the error
   * @returns The current workflow for chaining
   */
  public onError(handler: Taskish): Workflow {
    this._error = "";

    const parent = getLastTask(this);
    if (!parent) {
      this._error = "onError() requires a preceding task in the workflow";
      getLogger().error(this._error);
      throw new WorkflowError(this._error);
    }

    const handlerTask = ensureTask(handler);
    this.graph.addTask(handlerTask);

    // Connect the previous task's error output port to the handler's all-ports input
    const dataflow = new Dataflow(
      parent.id,
      DATAFLOW_ERROR_PORT,
      handlerTask.id,
      DATAFLOW_ALL_PORTS
    );
    this.graph.addDataflow(dataflow);
    this.events.emit("changed", handlerTask.id);

    return this;
  }

  toTaskGraph(): TaskGraph {
    return this._graph;
  }

  toTask(): GraphAsTask {
    const task = new WorkflowTask();
    task.subGraph = this.toTaskGraph();
    return task;
  }

  /**
   * Resets the task graph workflow to its initial state
   *
   * @returns The current task graph workflow
   */
  public reset(): Workflow {
    // In loop builder mode, reset is not supported
    if (this._parentWorkflow) {
      throw new WorkflowError("Cannot reset a loop workflow. Call reset() on the parent workflow.");
    }

    this.clearEvents();
    this._graph = new TaskGraph({
      outputCache: this._outputCache,
    });
    this._dataFlows = [];
    this._error = "";
    this.setupEvents();
    this.events.emit("changed", undefined);
    this.events.emit("reset");
    return this;
  }

  /**
   * Sets up event listeners for the task graph
   */
  private setupEvents(): void {
    this._graph.on("task_added", this._onChanged);
    this._graph.on("task_replaced", this._onChanged);
    this._graph.on("task_removed", this._onChanged);
    this._graph.on("dataflow_added", this._onChanged);
    this._graph.on("dataflow_replaced", this._onChanged);
    this._graph.on("dataflow_removed", this._onChanged);
    this._entitlementUnsub = this._graph.subscribeToTaskEntitlements((entitlements) =>
      this.events.emit("entitlementChange", entitlements)
    );
  }

  /**
   * Clears event listeners for the task graph
   */
  private clearEvents(): void {
    this._graph.off("task_added", this._onChanged);
    this._graph.off("task_replaced", this._onChanged);
    this._graph.off("task_removed", this._onChanged);
    this._graph.off("dataflow_added", this._onChanged);
    this._graph.off("dataflow_replaced", this._onChanged);
    this._graph.off("dataflow_removed", this._onChanged);
    this._entitlementUnsub?.();
    this._entitlementUnsub = undefined;
  }

  /**
   * Handles changes to the task graph
   */
  private _onChanged(id: unknown): void {
    this.events.emit("changed", id);
  }

  /**
   * Connects outputs to inputs between tasks
   */
  public connect(
    sourceTaskId: unknown,
    sourceTaskPortId: string,
    targetTaskId: unknown,
    targetTaskPortId: string
  ): Workflow {
    const sourceTask = this.graph.getTask(sourceTaskId);
    const targetTask = this.graph.getTask(targetTaskId);

    if (!sourceTask || !targetTask) {
      throw new WorkflowError("Source or target task not found");
    }

    const sourceSchema = sourceTask.outputSchema();
    const targetSchema = targetTask.inputSchema();

    // Handle boolean schemas
    if (typeof sourceSchema === "boolean") {
      if (sourceSchema === false) {
        throw new WorkflowError(`Source task has schema 'false' and outputs nothing`);
      }
      // If sourceSchema is true, we skip validation as it accepts everything
    } else if (!sourceSchema.properties?.[sourceTaskPortId]) {
      throw new WorkflowError(`Output ${sourceTaskPortId} not found on source task`);
    }

    if (typeof targetSchema === "boolean") {
      if (targetSchema === false) {
        throw new WorkflowError(`Target task has schema 'false' and accepts no inputs`);
      }
      if (targetSchema === true) {
        // do nothing, we allow additional properties
      }
    } else if (targetSchema.additionalProperties === true) {
      // do nothing, we allow additional properties
    } else if (!targetSchema.properties?.[targetTaskPortId]) {
      throw new WorkflowError(`Input ${targetTaskPortId} not found on target task`);
    }

    const dataflow = new Dataflow(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId);
    this.graph.addDataflow(dataflow);
    return this;
  }

  public addTaskToGraph<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(taskClass: ITaskConstructor<I, O, C>, config: C): ITask<I, O, C> {
    const task = new taskClass(config, this._registry ? { registry: this._registry } : undefined);
    const id = this.graph.addTask(task);
    this.events.emit("changed", id);
    return task;
  }

  /**
   * Adds a task to the workflow using the same logic as createWorkflow() helpers.
   * Auto-generates an ID, processes pending dataflows, and auto-connects to previous tasks.
   *
   * @param taskClass - The task class to instantiate and add
   * @param input - Optional input values for the task
   * @param config - Optional configuration (id will be auto-generated if not provided)
   * @returns The workflow for chaining
   */
  public addTask<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I> = TaskConfig<I>>(
    taskClass: ITaskConstructor<I, O, C>,
    input?: Partial<I>,
    config?: Partial<C>
  ): Workflow<Input, Output> {
    const helper = Workflow.createWorkflow<I, O, C>(taskClass);
    return helper.call(this, input, config) as Workflow<Input, Output>;
  }

  // ========================================================================
  // Loop Builder Methods
  // ========================================================================

  /**
   * Adds an iterator/loop task to the workflow using the same auto-connect logic
   * as regular task addition (createWorkflow), then returns a new loop builder Workflow.
   *
   * @param taskClass - The iterator task class (MapTask, ReduceTask, etc.)
   * @param config - Optional configuration for the iterator task
   * @returns A new loop builder Workflow for adding tasks inside the loop
   */
  public addLoopTask<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(taskClass: ITaskConstructor<I, O, C>, config: Partial<C> = {}): Workflow<I, O> {
    this._error = "";

    const parent = getLastTask(this);

    // Default maxIterations to "unbounded" for loop tasks whose config schema
    // marks it as required (MapTask, WhileTask, ReduceTask, ForEachTask). The
    // raw task constructors still require an explicit value; this default is a
    // convenience only for the fluent Workflow builder API.
    const schema = (
      taskClass as unknown as { configSchema?: () => DataPortSchema }
    ).configSchema?.();
    const required =
      typeof schema === "object" && schema !== null
        ? (schema as { required?: readonly string[] }).required
        : undefined;
    const needsMaxIterations = Array.isArray(required) && required.includes("maxIterations");
    const resolvedConfig =
      needsMaxIterations && (config as { maxIterations?: unknown }).maxIterations === undefined
        ? ({ ...config, maxIterations: "unbounded" } as Partial<C>)
        : config;

    const task = this.addTaskToGraph<I, O, C>(taskClass, { id: uuid4(), ...resolvedConfig } as C);

    // Process any pending data flows (same as createWorkflow)
    if (this._dataFlows.length > 0) {
      this._dataFlows.forEach((dataflow) => {
        const taskSchema = task.inputSchema();
        if (
          (typeof taskSchema !== "boolean" &&
            taskSchema.properties?.[dataflow.targetTaskPortId] === undefined &&
            taskSchema.additionalProperties !== true) ||
          (taskSchema === true && dataflow.targetTaskPortId !== DATAFLOW_ALL_PORTS)
        ) {
          this._error = `Input ${dataflow.targetTaskPortId} not found on task ${task.id}`;
          getLogger().error(this._error);
          return;
        }

        dataflow.targetTaskId = task.id;
        this.graph.addDataflow(dataflow);
      });

      this._dataFlows = [];
    }

    // Defer auto-connect until endMap/endReduce/endWhile, when the iterator task
    // has its template graph populated and its dynamic inputSchema is available.
    // Store the pending context on the loop builder workflow.
    const loopBuilder = new Workflow(
      this.outputCache(),
      this,
      task as unknown as GraphAsTask,
      this._registry
    ) as unknown as Workflow<I, O>;
    if (parent) {
      loopBuilder._pendingLoopConnect = { parent, iteratorTask: task };
    }
    return loopBuilder;
  }

  /**
   * Opens a conditional branch. Returns a {@link ConditionalBuilder} that
   * accepts `.then(taskClass)` and optional `.else(taskClass)` arms and is
   * closed via `.endIf()` to return to this workflow.
   *
   * @example
   * ```ts
   * workflow
   *   .if((input) => input.kind === "text")
   *   .then(TextTask)
   *   .else(ImageTask)
   *   .endIf();
   * ```
   */
  public if(condition: ConditionFn<TaskInput>): ConditionalBuilder {
    return new ConditionalBuilder(this, condition);
  }

  /**
   * Runs deferred auto-connect for a loop task on this (parent) workflow's graph.
   * Called after finalizeTemplate() populates the iterator task's template graph,
   * so that the iterator task's dynamic inputSchema() is available for matching.
   */
  public autoConnectLoopTask(pending?: { parent: ITask; iteratorTask: ITask }): void {
    if (!pending) return;
    const { parent, iteratorTask } = pending;

    if (this.graph.getTargetDataflows(parent.id).length === 0) {
      const nodes = this._graph.getTasks();
      const parentIndex = nodes.findIndex((n) => n.id === parent.id);
      const earlierTasks: ITask[] = [];
      for (let i = parentIndex - 1; i >= 0; i--) {
        earlierTasks.push(nodes[i]);
      }

      const result = Workflow.autoConnect(this.graph, parent, iteratorTask, {
        earlierTasks,
      });

      if (result.error) {
        this._error = result.error + " Task not added.";
        getLogger().error(this._error);
        this.graph.removeTask(iteratorTask.id);
      }
    }
  }

  /**
   * Updates InputTask/OutputTask config schemas based on their connected dataflows.
   * InputTask schema reflects its outgoing dataflow targets' input schemas.
   * OutputTask schema reflects its incoming dataflow sources' output schemas.
   */
  private static updateBoundaryTaskSchemas(graph: TaskGraph): void {
    const tasks = graph.getTasks();

    for (const task of tasks) {
      if (task.type === "InputTask") {
        // If the schema is marked as fully manual (x-ui-manual at schema level),
        // skip edge-based regeneration — the user explicitly defined this schema.
        const existingConfig = (task as ITask).config;
        const existingSchema = existingConfig?.inputSchema ?? existingConfig?.outputSchema;
        if (
          existingSchema &&
          typeof existingSchema === "object" &&
          (existingSchema as Record<string, unknown>)["x-ui-manual"] === true
        ) {
          continue;
        }

        const outgoing = graph.getTargetDataflows(task.id);
        if (outgoing.length === 0) continue;

        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const df of outgoing) {
          const targetTask = graph.getTask(df.targetTaskId);
          if (!targetTask) continue;
          const targetSchema = targetTask.inputSchema();
          if (typeof targetSchema === "boolean") continue;
          const prop = (targetSchema.properties as any)?.[df.targetTaskPortId];
          if (prop && typeof prop !== "boolean") {
            properties[df.sourceTaskPortId] = prop;
            if (targetSchema.required?.includes(df.targetTaskPortId)) {
              if (!required.includes(df.sourceTaskPortId)) {
                required.push(df.sourceTaskPortId);
              }
            }
          }
        }

        const schema = {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        } as DataPortSchema;

        // @ts-expect-error - config is readonly
        task.config = {
          ...task.config,
          inputSchema: schema,
          outputSchema: schema,
        };
      }

      if (task.type === "OutputTask") {
        const incoming = graph.getSourceDataflows(task.id);
        if (incoming.length === 0) continue;

        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const df of incoming) {
          const sourceTask = graph.getTask(df.sourceTaskId);
          if (!sourceTask) continue;
          const sourceSchema = sourceTask.outputSchema();
          if (typeof sourceSchema === "boolean") continue;
          let prop = (sourceSchema.properties as any)?.[df.sourceTaskPortId];
          let propRequired = sourceSchema.required?.includes(df.sourceTaskPortId) ?? false;

          // For passthrough tasks with additionalProperties (e.g. DebugLogTask),
          // the port won't appear in the static output schema. Trace back through
          // the passthrough task's own incoming dataflows to find the actual schema.
          if (
            !prop &&
            sourceSchema.additionalProperties === true &&
            (sourceTask.constructor as typeof Task).passthroughInputsToOutputs === true
          ) {
            const upstreamDfs = graph.getSourceDataflows(sourceTask.id);
            for (const udf of upstreamDfs) {
              if (udf.targetTaskPortId !== df.sourceTaskPortId) continue;
              const upstreamTask = graph.getTask(udf.sourceTaskId);
              if (!upstreamTask) continue;
              const upstreamSchema = upstreamTask.outputSchema();
              if (typeof upstreamSchema === "boolean") continue;
              prop = (upstreamSchema.properties as any)?.[udf.sourceTaskPortId];
              if (prop) {
                propRequired = upstreamSchema.required?.includes(udf.sourceTaskPortId) ?? false;
                break;
              }
            }
          }

          if (prop && typeof prop !== "boolean") {
            properties[df.targetTaskPortId] = prop;
            if (propRequired && !required.includes(df.targetTaskPortId)) {
              required.push(df.targetTaskPortId);
            }
          }
        }

        const schema = {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        } as DataPortSchema;

        // @ts-expect-error - config is readonly
        task.config = {
          ...task.config,
          inputSchema: schema,
          outputSchema: schema,
        };
      }
    }
  }

  /**
   * Options for auto-connect operation.
   */
  public static readonly AutoConnectOptions: unique symbol = Symbol("AutoConnectOptions");

  /**
   * Auto-connects two tasks based on their schemas.
   * Uses multiple matching strategies:
   * 1. Match by type AND port name (highest priority)
   * 2. Match by specific type only (format, $id) for unmatched ports
   * 3. Look back through earlier tasks for unmatched required inputs
   *
   * @param graph - The task graph to add dataflows to
   * @param sourceTask - The source task to connect from
   * @param targetTask - The target task to connect to
   * @param options - Optional configuration for the auto-connect operation
   * @returns Result containing matches made, any errors, and unmatched required inputs
   */
  public static autoConnect(
    graph: TaskGraph,
    sourceTask: ITask,
    targetTask: ITask,
    options?: {
      /** Keys of inputs that are already provided and don't need connection */
      readonly providedInputKeys?: Set<string>;
      /** Keys of inputs that are already connected via dataflow (e.g., from rename) and must not be re-matched */
      readonly connectedInputKeys?: Set<string>;
      /** Earlier tasks to search for unmatched required inputs (in reverse chronological order) */
      readonly earlierTasks?: readonly ITask[];
    }
  ): {
    readonly matches: Map<string, string>;
    readonly error?: string;
    readonly unmatchedRequired: readonly string[];
  } {
    return autoConnect(graph, sourceTask, targetTask, options);
  }

  /**
   * Finalizes the template graph and sets it on the iterator task.
   * Only applicable in loop builder mode.
   */
  public finalizeTemplate(): void {
    if (!this._iteratorTask || this.graph.getTasks().length === 0) {
      return;
    }

    this._iteratorTask.subGraph = this.graph;
    this._iteratorTask.validateAcyclic();
  }

  /**
   * Finalizes the template graph and returns the parent workflow.
   * Only applicable in loop builder mode.
   *
   * @returns The parent workflow
   * @throws WorkflowError if not in loop builder mode
   */
  public finalizeAndReturn(): Workflow {
    if (!this._parentWorkflow) {
      throw new WorkflowError("finalizeAndReturn() can only be called on loop workflows");
    }
    this.finalizeTemplate();
    // Now that the iterator task has its template graph, its dynamic inputSchema()
    // is available. Run deferred auto-connect on the parent workflow's graph.
    if (this._pendingLoopConnect) {
      this._parentWorkflow.autoConnectLoopTask(this._pendingLoopConnect);
      this._pendingLoopConnect = undefined;
    }
    return this._parentWorkflow;
  }
}

// Module augmentation prototype assignments — placed here (not in GraphAsTask.ts)
// so that Workflow is fully defined before assignment. GraphAsTask is already
// imported at the top of this file, so it's safe to reference here.
Workflow.prototype.group = CreateLoopWorkflow(GraphAsTask);
Workflow.prototype.endGroup = CreateEndLoopWorkflow("endGroup");

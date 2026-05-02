/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import { EventEmitter, ServiceRegistry } from "@workglow/util";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";
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
import type { ConditionalBuilder } from "./ConditionalBuilder";
import type { PipeFunction, Taskish } from "./Conversions";
import type { GraphEntitlementOptions } from "./GraphEntitlementUtils";
import { computeGraphEntitlements } from "./GraphEntitlementUtils";
import type { IWorkflow, WorkflowRunConfig } from "./IWorkflow";
import { LoopBuilderContext, runLoopAutoConnect } from "./LoopBuilderContext";
import { TaskGraph } from "./TaskGraph";
import type { PropertyArrayGraphResult } from "./TaskGraphRunner";
import { CompoundMergeStrategy, PROPERTY_ARRAY } from "./TaskGraphRunner";
import type { ITransformStep } from "./TransformTypes";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { WorkflowCacheAdapter } from "./WorkflowCacheAdapter";
import { WorkflowEventBridge } from "./WorkflowEventBridge";
import type { CreateWorkflow } from "./WorkflowFactories";
import { CreateEndLoopWorkflow, CreateLoopWorkflow } from "./WorkflowFactories";
import { parallel, pipe } from "./WorkflowPipe";
import { WorkflowTask } from "./WorkflowTask";

/** Options accepted by {@link Workflow.rename}. */
export interface RenameOptions {
  /** Index of the task whose output is renamed (defaults to the last task, `-1`). */
  readonly index?: number;
  /** Transform chain applied to the dataflow edge this rename creates. */
  readonly transforms?: ReadonlyArray<ITransformStep>;
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
    this._cache = new WorkflowCacheAdapter(cache);
    this._graph = new TaskGraph({ outputCache: this._cache.outputCache() });

    const loopContext =
      parent && iteratorTask ? new LoopBuilderContext(parent, iteratorTask) : undefined;

    this._builder = new WorkflowBuilder(
      this,
      registry ?? parent?.builderRegistry,
      loopContext
    );

    if (!parent) {
      this._bridge = new WorkflowEventBridge(this.events);
      this._bridge.attach(this._graph);
    }
  }

  // Private properties
  private _graph: TaskGraph;
  private _cache: WorkflowCacheAdapter;
  private _bridge?: WorkflowEventBridge;
  private _builder: WorkflowBuilder;

  // Abort controller for cancelling task execution
  private _abortController?: AbortController;

  /** @internal — exposes the parent's registry so a child loop-builder can inherit it */
  private get builderRegistry(): ServiceRegistry | undefined {
    return this._builder.registry;
  }

  /** @internal — exposes the builder for cross-instance loop-builder wiring */
  public get builder(): WorkflowBuilder {
    return this._builder;
  }

  public outputCache(): TaskOutputRepository | undefined {
    return this._cache.outputCache();
  }

  /**
   * Whether this workflow is in loop builder mode.
   * When true, tasks are added to the template graph for an iterator task.
   */
  public get isLoopBuilder(): boolean {
    return this._builder.loopContext !== undefined;
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
      this._builder.addTaskWithAutoConnect<I, O, C>(taskClass, input, config);
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
    this._builder.resetState();
    this._bridge?.detach();
    this._graph = value;
    this._bridge?.attach(this._graph);
    this.events.emit("reset");
  }

  /**
   * Gets the current error message
   */
  public get error(): string {
    return this._builder.error;
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
    const loopContext = this._builder.loopContext;
    if (loopContext) {
      loopContext.finalizeTemplate(this._graph);
      const error = loopContext.consumePendingConnect();
      if (error) loopContext.parent.builder.setError(error);
      return loopContext.parent.run(input as any, config) as Promise<
        PropertyArrayGraphResult<Output>
      >;
    }

    this.events.emit("start");
    this._abortController = new AbortController();

    // Subscribe to graph-level streaming events and forward to workflow events.
    // The unsub token is held LOCAL to this run so concurrent run() calls don't
    // clobber each other's streaming subscriptions.
    const unsubStreaming = this._bridge?.beginRun();

    try {
      const output = await this.graph.run<Output>(input, {
        parentSignal: this._abortController.signal,
        outputCache: this._cache.outputCache(),
        registry: config?.registry ?? this._builder.registry,
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
      unsubStreaming?.();
      this._abortController = undefined;
    }
  }

  /**
   * Aborts the running task graph
   */
  public async abort(): Promise<void> {
    // In loop builder mode, delegate to parent
    const loopContext = this._builder.loopContext;
    if (loopContext) {
      return loopContext.parent.abort();
    }
    this._abortController?.abort();
  }

  /**
   * Removes the last task from the task graph
   *
   * @returns The current task graph workflow
   */
  public pop(): Workflow {
    this._builder.pop();
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
    this._builder.rename(source, target, indexOrOptions);
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
    this._builder.onError(handler);
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
    if (this._builder.loopContext) {
      throw new WorkflowError("Cannot reset a loop workflow. Call reset() on the parent workflow.");
    }

    this._bridge?.detach();
    this._graph = new TaskGraph({
      outputCache: this._cache.outputCache(),
    });
    this._builder.resetState();
    this._bridge?.attach(this._graph);
    this.events.emit("changed", undefined);
    this.events.emit("reset");
    return this;
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
    this._builder.connect(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId);
    return this;
  }

  public addTaskToGraph<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(taskClass: ITaskConstructor<I, O, C>, config: C): ITask<I, O, C> {
    return this._builder.addTaskInstance<I, O, C>(taskClass, config);
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
    return this._builder.addTaskWithAutoConnect<I, O, C>(taskClass, input, config) as Workflow<
      Input,
      Output
    >;
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
    return this._builder.addLoopTask<I, O, C>(taskClass, config);
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
    return this._builder.createConditional(condition);
  }

  /**
   * Runs deferred auto-connect for a loop task on this (parent) workflow's graph.
   * Called after finalizeTemplate() populates the iterator task's template graph,
   * so that the iterator task's dynamic inputSchema() is available for matching.
   */
  public autoConnectLoopTask(pending?: { parent: ITask; iteratorTask: ITask }): void {
    if (!pending) return;
    const error = runLoopAutoConnect(this._graph, pending);
    if (error) this._builder.setError(error);
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
    const ctx = this._builder.loopContext;
    if (!ctx) return;
    ctx.finalizeTemplate(this._graph);
  }

  /**
   * Finalizes the template graph and returns the parent workflow.
   * Only applicable in loop builder mode.
   *
   * @returns The parent workflow
   * @throws WorkflowError if not in loop builder mode
   */
  public finalizeAndReturn(): Workflow {
    const ctx = this._builder.loopContext;
    if (!ctx) {
      throw new WorkflowError("finalizeAndReturn() can only be called on loop workflows");
    }
    return ctx.finalizeAndReturn(this._graph);
  }
}

// Module augmentation prototype assignments — placed here (not in WorkflowFactories.ts)
// so they run after the Workflow class declaration. Static imports in ESM are
// hoisted and evaluated depth-first, so a side-effect tail import would run
// before the class binding initializes. Inline assignments here are safe because
// the class is already fully initialized by this point.
Workflow.prototype.group = CreateLoopWorkflow(GraphAsTask);
Workflow.prototype.endGroup = CreateEndLoopWorkflow("endGroup");

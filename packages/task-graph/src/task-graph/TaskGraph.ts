/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope } from "@workglow/util";
import { EventEmitter, ServiceRegistry, uuid4 } from "@workglow/util";
import { DirectedAcyclicGraph } from "@workglow/util/graph";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ITask } from "../task/ITask";
import type { StreamEvent } from "../task/StreamTypes";
import type { TaskEntitlements } from "../task/TaskEntitlements";
import type { JsonTaskItem, TaskGraphJson, TaskGraphJsonOptions } from "../task/TaskJSON";
import type { TaskIdType, TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import type { PipeFunction } from "./Conversions";
import { ensureTask } from "./Conversions";
import type { DataflowIdType } from "./Dataflow";
import { Dataflow } from "./Dataflow";
import { computeGraphEntitlements } from "./GraphEntitlementUtils";
import { addBoundaryNodesToDependencyJson, addBoundaryNodesToGraphJson } from "./GraphSchemaUtils";
import type { ITaskGraph } from "./ITaskGraph";
import {
  EventTaskGraphToDagMapping,
  GraphEventDagEvents,
  GraphEventDagParameters,
  TaskGraphEventListener,
  TaskGraphEvents,
  TaskGraphEventStatusParameters,
  TaskGraphStatusEvents,
  TaskGraphStatusListeners,
} from "./TaskGraphEvents";
import type { GraphResultArray } from "./TaskGraphRunner";
import { CompoundMergeStrategy, GraphResult, TaskGraphRunner } from "./TaskGraphRunner";

/**
 * Configuration for running a task graph
 */
export interface TaskGraphRunConfig {
  /** Optional output cache to use for this task graph */
  outputCache?: TaskOutputRepository | boolean;
  /** Optional if we should match all empty inputs with the graph input */
  matchAllEmptyInputs?: boolean;
  /** Optional signal to abort the task graph */
  parentSignal?: AbortSignal;
  /** Optional service registry to use for this task graph (creates child from global if not provided) */
  registry?: ServiceRegistry;
  /**
   * When true, streaming leaf tasks (no outgoing edges) accumulate their full
   * output so the workflow return value is complete. Defaults to true.
   * Pass false for subgraph runs where the parent handles streaming via
   * subscriptions and does not rely on the return value for stream data.
   */
  accumulateLeafOutputs?: boolean;
  /**
   * Maximum time in milliseconds for the entire graph execution.
   * When exceeded, all in-progress tasks are aborted and a TaskTimeoutError is thrown.
   */
  timeout?: number;
  /**
   * Maximum number of tasks allowed in the graph. Validated before execution starts.
   * Defaults to no limit. Set this to prevent runaway graph construction.
   */
  maxTasks?: number;
  /**
   * When true, check entitlements via the registered IEntitlementEnforcer before
   * graph execution begins. Throws TaskEntitlementError if any required (non-optional)
   * entitlements are denied. Default: false.
   */
  enforceEntitlements?: boolean;
  /**
   * Resource scope for collecting heavyweight resource disposers during graph execution.
   * Threaded to all tasks via IExecuteContext. The caller controls disposal.
   */
  resourceScope?: ResourceScope;
}

export interface TaskGraphRunPreviewConfig extends Omit<
  TaskGraphRunConfig,
  "enforceEntitlements" | "timeout"
> {
  /** Optional service registry to use for this task graph */
  registry?: ServiceRegistry;
}

class TaskGraphDAG extends DirectedAcyclicGraph<
  ITask<any, any, any>,
  Dataflow,
  TaskIdType,
  DataflowIdType
> {
  constructor() {
    super(
      (task: ITask<any, any, any>) => task.id,
      (dataflow: Dataflow) => dataflow.id
    );
  }
}

interface TaskGraphConstructorConfig {
  outputCache?: TaskOutputRepository;
  dag?: TaskGraphDAG;
}

/**
 * Represents a task graph, a directed acyclic graph of tasks and data flows
 */
export class TaskGraph implements ITaskGraph {
  /** Optional output cache to use for this task graph */
  public outputCache?: TaskOutputRepository;

  /**
   * Constructor for TaskGraph
   * @param config Configuration for the task graph
   */
  constructor({ outputCache, dag }: TaskGraphConstructorConfig = {}) {
    this.outputCache = outputCache;
    this._dag = dag || new TaskGraphDAG();
  }

  private _dag: TaskGraphDAG;

  private _runner: TaskGraphRunner | undefined;
  public get runner(): TaskGraphRunner {
    if (!this._runner) {
      this._runner = new TaskGraphRunner(this, this.outputCache);
    }
    return this._runner;
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  /**
   * Runs the task graph
   * @param config Configuration for the graph run
   * @returns A promise that resolves when all tasks are complete
   * @throws TaskError if any tasks have failed
   */
  public run<ExecuteOutput extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config: TaskGraphRunConfig = {}
  ): Promise<GraphResultArray<ExecuteOutput>> {
    return this.runner.runGraph<ExecuteOutput>(input, {
      outputCache: config?.outputCache || this.outputCache,
      parentSignal: config?.parentSignal || undefined,
      accumulateLeafOutputs: config?.accumulateLeafOutputs,
      registry: config?.registry,
      timeout: config?.timeout,
      maxTasks: config?.maxTasks,
      resourceScope: config?.resourceScope,
    });
  }

  /**
   * Runs the task graph in preview mode
   * @returns A promise that resolves when all tasks are complete
   * @throws TaskError if any tasks have failed
   */
  public runPreview<Output extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config: TaskGraphRunConfig = {}
  ): Promise<GraphResultArray<Output>> {
    return this.runner.runGraphPreview<Output>(input, config);
  }

  /**
   * Merges the execute output to the run output
   * @param results The execute output
   * @param compoundMerge The compound merge strategy to use
   * @returns The run output
   */

  public mergeExecuteOutputsToRunOutput<
    ExecuteOutput extends TaskOutput,
    Merge extends CompoundMergeStrategy = CompoundMergeStrategy,
  >(
    results: GraphResultArray<ExecuteOutput>,
    compoundMerge: Merge
  ): GraphResult<ExecuteOutput, Merge> {
    return this.runner.mergeExecuteOutputsToRunOutput(results, compoundMerge);
  }

  /**
   * Aborts the task graph
   */
  public abort() {
    this.runner.abort();
  }

  /**
   * Disables the task graph
   */
  public async disable() {
    await this.runner.disable();
  }

  /**
   * Retrieves a task from the task graph by its id
   * @param id The id of the task to retrieve
   * @returns The task with the given id, or undefined if not found
   */
  public getTask(id: TaskIdType): ITask<any, any, any> | undefined {
    return this._dag.getNode(id);
  }

  /**
   * Retrieves all tasks in the task graph
   * @returns An array of tasks in the task graph
   */
  public getTasks(): ITask<any, any, any>[] {
    return this._dag.getNodes();
  }

  /**
   * Retrieves all tasks in the task graph topologically sorted
   * @returns An array of tasks in the task graph topologically sorted
   */
  public topologicallySortedNodes(): ITask<any, any, any>[] {
    return this._dag.topologicallySortedNodes();
  }

  /**
   * Returns true if the underlying DAG is acyclic. Cycles are already rejected
   * synchronously by {@link addDataflow}, so this is a defensive check for
   * direct `_dag` manipulation or invariant re-assertion after cloning.
   */
  public isAcyclic(): boolean {
    return this._dag.isAcyclic();
  }

  /**
   * Adds a task to the task graph
   * @param task The task to add
   * @returns The current task graph
   */
  public addTask(fn: PipeFunction<any, any>, config?: any): unknown;
  public addTask(task: ITask<any, any, any>): unknown;
  public addTask(task: ITask<any, any, any> | PipeFunction<any, any>, config?: any): unknown {
    const t = ensureTask(task, config);
    t.parentGraph = this;
    return this._dag.addNode(t);
  }

  /**
   * Adds multiple tasks to the task graph
   * @param tasks The tasks to add
   * @returns The current task graph
   */
  public addTasks(tasks: PipeFunction<any, any>[]): unknown[];
  public addTasks(tasks: ITask<any, any, any>[]): unknown[];
  public addTasks(tasks: ITask<any, any, any>[] | PipeFunction<any, any>[]): unknown[] {
    const resolved = tasks.map(ensureTask);
    for (const t of resolved) {
      t.parentGraph = this;
    }
    return this._dag.addNodes(resolved);
  }

  /**
   * Adds a data flow to the task graph
   * @param dataflow The data flow to add
   * @returns The current task graph
   */
  public addDataflow(dataflow: Dataflow) {
    return this._dag.addEdge(dataflow.sourceTaskId, dataflow.targetTaskId, dataflow);
  }

  /**
   * Adds multiple data flows to the task graph
   * @param dataflows The data flows to add
   * @returns The current task graph
   */
  public addDataflows(dataflows: Dataflow[]) {
    const addedEdges = dataflows.map<[s: unknown, t: unknown, e: Dataflow]>((edge) => {
      return [edge.sourceTaskId, edge.targetTaskId, edge];
    });
    return this._dag.addEdges(addedEdges);
  }

  /**
   * Retrieves a data flow from the task graph by its id
   * @param id The id of the data flow to retrieve
   * @returns The data flow with the given id, or undefined if not found
   */
  public getDataflow(id: DataflowIdType): Dataflow | undefined {
    for (const [, , edge] of this._dag.getEdges()) {
      if (edge.id === id) {
        return edge;
      }
    }
    return undefined;
  }

  /**
   * Retrieves all data flows in the task graph
   * @returns An array of data flows in the task graph
   */
  public getDataflows(): Dataflow[] {
    return this._dag.getEdges().map((edge) => edge[2]);
  }

  /**
   * Removes a data flow from the task graph
   * @param dataflow The data flow to remove
   * @returns The current task graph
   */
  public removeDataflow(dataflow: Dataflow) {
    return this._dag.removeEdge(dataflow.sourceTaskId, dataflow.targetTaskId, dataflow.id);
  }

  /**
   * Retrieves the data flows that are sources of a given task
   * @param taskId The id of the task to retrieve sources for
   * @returns An array of data flows that are sources of the given task
   */
  public getSourceDataflows(taskId: unknown): Dataflow[] {
    return this._dag.inEdges(taskId).map(([, , dataflow]) => dataflow);
  }

  /**
   * Retrieves the data flows that are targets of a given task
   * @param taskId The id of the task to retrieve targets for
   * @returns An array of data flows that are targets of the given task
   */
  public getTargetDataflows(taskId: unknown): Dataflow[] {
    return this._dag.outEdges(taskId).map(([, , dataflow]) => dataflow);
  }

  /**
   * Retrieves the tasks that are sources of a given task
   * @param taskId The id of the task to retrieve sources for
   * @returns An array of tasks that are sources of the given task
   */
  public getSourceTasks(taskId: unknown): ITask<any, any, any>[] {
    return this.getSourceDataflows(taskId).map((dataflow) => this.getTask(dataflow.sourceTaskId)!);
  }

  /**
   * Retrieves the tasks that are targets of a given task
   * @param taskId The id of the task to retrieve targets for
   * @returns An array of tasks that are targets of the given task
   */
  public getTargetTasks(taskId: unknown): ITask<any, any, any>[] {
    return this.getTargetDataflows(taskId).map((dataflow) => this.getTask(dataflow.targetTaskId)!);
  }

  /**
   * Removes a task from the task graph
   * @param taskId The id of the task to remove
   * @returns The current task graph
   */
  public removeTask(taskId: unknown) {
    return this._dag.removeNode(taskId);
  }

  public resetGraph() {
    this.runner.resetGraph(this, uuid4());
  }

  /**
   * Converts the task graph to a JSON format suitable for dependency tracking
   * @param options Options controlling serialization (e.g., boundary nodes)
   * @returns A TaskGraphJson object representing the tasks and dataflows
   */
  public toJSON(options?: TaskGraphJsonOptions): TaskGraphJson {
    const tasks = this.getTasks().map((node) => node.toJSON(options));
    const dataflows = this.getDataflows().map((df) => df.toJSON());
    let json: TaskGraphJson = {
      tasks,
      dataflows,
    };
    if (options?.withBoundaryNodes) {
      json = addBoundaryNodesToGraphJson(json, this);
    }
    return json;
  }

  /**
   * Converts the task graph to a JSON format suitable for dependency tracking
   * @param options Options controlling serialization (e.g., boundary nodes)
   * @returns An array of JsonTaskItem objects, each representing a task and its dependencies
   */
  public toDependencyJSON(options?: TaskGraphJsonOptions): JsonTaskItem[] {
    const tasks = this.getTasks().flatMap((node) => node.toDependencyJSON(options));
    this.getDataflows().forEach((df) => {
      const target = tasks.find((node) => node.id === df.targetTaskId)!;
      if (!target.dependencies) {
        target.dependencies = {};
      }
      const targetDeps = target.dependencies[df.targetTaskPortId];
      if (!targetDeps) {
        target.dependencies[df.targetTaskPortId] = {
          id: df.sourceTaskId,
          output: df.sourceTaskPortId,
        };
      } else {
        if (Array.isArray(targetDeps)) {
          targetDeps.push({
            id: df.sourceTaskId,
            output: df.sourceTaskPortId,
          });
        } else {
          target.dependencies[df.targetTaskPortId] = [
            targetDeps,
            { id: df.sourceTaskId, output: df.sourceTaskPortId },
          ];
        }
      }
    });
    if (options?.withBoundaryNodes) {
      return addBoundaryNodesToDependencyJson(tasks, this);
    }
    return tasks;
  }

  // ========================================================================
  // Event handling
  // ========================================================================

  /**
   * Event emitter for task lifecycle events
   */
  public get events(): EventEmitter<TaskGraphStatusListeners> {
    if (!this._events) {
      this._events = new EventEmitter<TaskGraphStatusListeners>();
    }
    return this._events;
  }
  protected _events: EventEmitter<TaskGraphStatusListeners> | undefined;

  /**
   * Subscribes to an event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   * @returns a function to unsubscribe from the event
   */
  public subscribe<Event extends TaskGraphEvents>(
    name: Event,
    fn: TaskGraphEventListener<Event>
  ): () => void {
    this.on(name, fn);
    return () => this.off(name, fn);
  }

  /**
   * Subscribes to status changes on all tasks (existing and future)
   * @param callback - Function called when any task's status changes
   * @param callback.taskId - The ID of the task whose status changed
   * @param callback.status - The new status of the task
   * @returns a function to unsubscribe from all task status events
   */
  public subscribeToTaskStatus(
    callback: (taskId: TaskIdType, status: TaskStatus) => void
  ): () => void {
    const unsubscribes: (() => void)[] = [];

    // Subscribe to status events on all existing tasks
    const tasks = this.getTasks();
    tasks.forEach((task) => {
      const unsub = task.subscribe("status", (status) => {
        callback(task.id, status);
      });
      unsubscribes.push(unsub);
    });

    const handleTaskAdded = (taskId: TaskIdType) => {
      const task = this.getTask(taskId);
      if (!task || typeof task.subscribe !== "function") return;

      const unsub = task.subscribe("status", (status) => {
        callback(task.id, status);
      });
      unsubscribes.push(unsub);
    };

    const graphUnsub = this.subscribe("task_added", handleTaskAdded);
    unsubscribes.push(graphUnsub);

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Subscribes to progress updates on all tasks (existing and future)
   * @param callback - Function called when any task reports progress
   * @param callback.taskId - The ID of the task reporting progress
   * @param callback.progress - The progress value (0-100)
   * @param callback.message - Optional progress message
   * @param callback.args - Additional arguments passed with the progress update
   * @returns a function to unsubscribe from all task progress events
   */
  public subscribeToTaskProgress(
    callback: (taskId: TaskIdType, progress: number, message?: string, ...args: any[]) => void
  ): () => void {
    const unsubscribes: (() => void)[] = [];

    // Subscribe to progress events on all existing tasks
    const tasks = this.getTasks();
    tasks.forEach((task) => {
      const unsub = task.subscribe("progress", (progress, message, ...args) => {
        callback(task.id, progress, message, ...args);
      });
      unsubscribes.push(unsub);
    });

    const handleTaskAdded = (taskId: TaskIdType) => {
      const task = this.getTask(taskId);
      if (!task || typeof task.subscribe !== "function") return;

      const unsub = task.subscribe("progress", (progress, message, ...args) => {
        callback(task.id, progress, message, ...args);
      });
      unsubscribes.push(unsub);
    };

    const graphUnsub = this.subscribe("task_added", handleTaskAdded);
    unsubscribes.push(graphUnsub);

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Subscribes to status changes on all dataflows (existing and future)
   * @param callback - Function called when any dataflow's status changes
   * @param callback.dataflowId - The ID of the dataflow whose status changed
   * @param callback.status - The new status of the dataflow
   * @returns a function to unsubscribe from all dataflow status events
   */
  public subscribeToDataflowStatus(
    callback: (dataflowId: DataflowIdType, status: TaskStatus) => void
  ): () => void {
    const unsubscribes: (() => void)[] = [];

    // Subscribe to status events on all existing dataflows
    const dataflows = this.getDataflows();
    dataflows.forEach((dataflow) => {
      const unsub = dataflow.subscribe("status", (status) => {
        callback(dataflow.id, status);
      });
      unsubscribes.push(unsub);
    });

    const handleDataflowAdded = (dataflowId: DataflowIdType) => {
      const dataflow = this.getDataflow(dataflowId);
      if (!dataflow || typeof dataflow.subscribe !== "function") return;

      const unsub = dataflow.subscribe("status", (status) => {
        callback(dataflow.id, status);
      });
      unsubscribes.push(unsub);
    };

    const graphUnsub = this.subscribe("dataflow_added", handleDataflowAdded);
    unsubscribes.push(graphUnsub);

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Subscribes to streaming events on the task graph.
   * Listens for task_stream_start, task_stream_chunk, and task_stream_end
   * events emitted by the TaskGraphRunner during streaming task execution.
   *
   * @param callbacks - Object with optional callbacks for each streaming event
   * @returns a function to unsubscribe from all streaming events
   */
  public subscribeToTaskStreaming(callbacks: {
    onStreamStart?: (taskId: TaskIdType) => void;
    onStreamChunk?: (taskId: TaskIdType, event: StreamEvent) => void;
    onStreamEnd?: (taskId: TaskIdType, output: Record<string, any>) => void;
  }): () => void {
    const unsubscribes: (() => void)[] = [];

    if (callbacks.onStreamStart) {
      const unsub = this.subscribe("task_stream_start", callbacks.onStreamStart);
      unsubscribes.push(unsub);
    }

    if (callbacks.onStreamChunk) {
      const unsub = this.subscribe("task_stream_chunk", callbacks.onStreamChunk);
      unsubscribes.push(unsub);
    }

    if (callbacks.onStreamEnd) {
      const unsub = this.subscribe("task_stream_end", callbacks.onStreamEnd);
      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Subscribes to entitlement changes on all tasks (existing and future).
   * When any task's entitlements change, the graph recomputes and emits its own
   * `entitlementChange` event. Structural changes (task_added, task_removed) also trigger.
   *
   * @param callback - Function called with the aggregated entitlements whenever they change
   * @returns a function to unsubscribe from all entitlement events
   */
  public subscribeToTaskEntitlements(
    callback: (entitlements: TaskEntitlements) => void
  ): () => void {
    const globalUnsubs: (() => void)[] = [];
    const taskUnsubs = new Map<TaskIdType, () => void>();

    const emitChange = () => {
      const entitlements = computeGraphEntitlements(this);
      this.emit("entitlementChange", entitlements);
      callback(entitlements);
    };

    const subscribeTask = (taskId: TaskIdType) => {
      const task = this.getTask(taskId);
      if (!task || typeof task.subscribe !== "function") return;
      const unsub = task.subscribe("entitlementChange", () => emitChange());
      taskUnsubs.set(taskId, unsub);
    };

    // Subscribe to entitlementChange events on all existing tasks
    for (const task of this.getTasks()) {
      subscribeTask(task.id);
    }

    // Emit the initial state immediately so subscribers don't miss the current entitlements
    emitChange();

    // Subscribe to new tasks being added
    globalUnsubs.push(
      this.subscribe("task_added", (taskId: TaskIdType) => {
        subscribeTask(taskId);
        emitChange();
      })
    );

    globalUnsubs.push(
      this.subscribe("task_removed", (taskId: TaskIdType) => {
        const unsub = taskUnsubs.get(taskId);
        if (unsub) {
          unsub();
          taskUnsubs.delete(taskId);
        }
        emitChange();
      })
    );

    return () => {
      globalUnsubs.forEach((unsub) => unsub());
      taskUnsubs.forEach((unsub) => unsub());
      taskUnsubs.clear();
    };
  }

  /**
   * Registers an event listener for the specified event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   */
  on<Event extends TaskGraphEvents>(name: Event, fn: TaskGraphEventListener<Event>) {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    if (dagEvent) {
      // Safe cast: TaskGraph dag events (task_added, etc.) have the same signature as
      // the underlying DAG events (node-added, etc.) - both pass IDs, not full objects
      return this._dag.on(dagEvent, fn as Parameters<typeof this._dag.on>[1]);
    }
    return this.events.on(
      name as TaskGraphStatusEvents,
      fn as TaskGraphEventListener<TaskGraphStatusEvents>
    );
  }

  /**
   * Removes an event listener for the specified event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   */
  off<Event extends TaskGraphEvents>(name: Event, fn: TaskGraphEventListener<Event>) {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    if (dagEvent) {
      // Safe cast: TaskGraph dag events (task_added, etc.) have the same signature as
      // the underlying DAG events (node-added, etc.) - both pass IDs, not full objects
      return this._dag.off(dagEvent, fn as Parameters<typeof this._dag.off>[1]);
    }
    return this.events.off(
      name as TaskGraphStatusEvents,
      fn as TaskGraphEventListener<TaskGraphStatusEvents>
    );
  }

  /**
   * Emits an event for the specified event
   * @param name - The event name to emit
   * @param args - The arguments to pass to the event listener
   */
  emit<E extends GraphEventDagEvents>(name: E, ...args: GraphEventDagParameters<E>): void;
  emit<E extends TaskGraphStatusEvents>(name: E, ...args: TaskGraphEventStatusParameters<E>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(name: string, ...args: any[]): void {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    if (dagEvent) {
      // Safe: overload signatures guarantee correct arg types at call sites
      return (this.emit_dag as Function).call(this, name, ...args);
    } else {
      return (this.emit_local as Function).call(this, name, ...args);
    }
  }

  /**
   * Emits an event for the specified event
   * @param name - The event name to emit
   * @param args - The arguments to pass to the event listener
   */
  protected emit_local<Event extends TaskGraphStatusEvents>(
    name: Event,
    ...args: TaskGraphEventStatusParameters<Event>
  ) {
    return this.events?.emit(name, ...args);
  }

  /**
   * Emits an event for the specified event
   * @param name - The event name to emit
   * @param args - The arguments to pass to the event listener
   */
  protected emit_dag<Event extends GraphEventDagEvents>(
    name: Event,
    ...args: GraphEventDagParameters<Event>
  ) {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    // Safe cast: GraphEventDagParameters matches the DAG's emit parameters (both are ID-based)
    return this._dag.emit(dagEvent, ...(args as unknown as [unknown]));
  }
}

/**
 * Super simple helper if you know the input and output handles, and there is only one each
 *
 * @param tasks
 * @param inputHandle
 * @param outputHandle
 * @returns
 */
function serialGraphEdges(
  tasks: ITask<any, any, any>[],
  inputHandle: string,
  outputHandle: string
): Dataflow[] {
  const edges: Dataflow[] = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    edges.push(new Dataflow(tasks[i].id, inputHandle, tasks[i + 1].id, outputHandle));
  }
  return edges;
}

/**
 * Super simple helper if you know the input and output handles, and there is only one each
 *
 * @param tasks
 * @param inputHandle
 * @param outputHandle
 * @returns
 */
export function serialGraph(
  tasks: ITask<any, any, any>[],
  inputHandle: string,
  outputHandle: string
): TaskGraph {
  const graph = new TaskGraph();
  graph.addTasks(tasks);
  graph.addDataflows(serialGraphEdges(tasks, inputHandle, outputHandle));
  return graph;
}

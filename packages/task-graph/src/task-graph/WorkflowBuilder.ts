/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, ServiceRegistry, uuid4 } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import type { ConditionFn } from "../task/ConditionalTask";
import { GraphAsTask } from "../task/GraphAsTask";
import type { ITask, ITaskConstructor } from "../task/ITask";
import { WorkflowError } from "../task/TaskError";
import type { DataPorts, TaskConfig, TaskInput } from "../task/TaskTypes";
import { autoConnect } from "./autoConnect";
import { ConditionalBuilder } from "./ConditionalBuilder";
import type { Taskish } from "./Conversions";
import { ensureTask } from "./Conversions";
import { Dataflow, DATAFLOW_ALL_PORTS, DATAFLOW_ERROR_PORT } from "./Dataflow";
import { updateBoundaryTaskSchemas } from "./GraphSchemaUtils";
import { LoopBuilderContext } from "./LoopBuilderContext";
import type { RenameOptions, Workflow } from "./Workflow";
import { getLastTask } from "./WorkflowPipe";

/**
 * Owns the DSL state machine for a {@link Workflow}: the list of pending
 * dataflows queued by `.rename(...)`, the most recent error string, the
 * optional service registry, and the optional loop-builder context.
 *
 * The {@link Workflow} facade keeps its public method signatures and
 * delegates the implementation here. This split keeps the run/abort/event
 * surface separate from the chainable graph-construction surface.
 */
export class WorkflowBuilder {
  private readonly _facade: Workflow<any, any>;
  private _dataFlows: Dataflow[] = [];
  private _error: string = "";
  private readonly _registry?: ServiceRegistry;
  private readonly _loopContext?: LoopBuilderContext;

  constructor(
    facade: Workflow<any, any>,
    registry?: ServiceRegistry,
    loopContext?: LoopBuilderContext
  ) {
    this._facade = facade;
    this._registry = registry;
    this._loopContext = loopContext;
  }

  public get error(): string {
    return this._error;
  }

  public get registry(): ServiceRegistry | undefined {
    return this._registry;
  }

  public get loopContext(): LoopBuilderContext | undefined {
    return this._loopContext;
  }

  /**
   * Surfaces an error onto this builder's error slot. Used by deferred
   * loop-builder auto-connect (which runs from a child Workflow but reports
   * the failure onto the parent's `.error`, matching the non-loop path).
   */
  public setError(message: string): void {
    this._error = message;
  }

  /** Clears pending state. Called by the facade's graph setter and reset(). */
  public resetState(): void {
    this._dataFlows = [];
    this._error = "";
  }

  /**
   * Instantiates a task and adds it to the facade's graph; emits "changed".
   * Used both by {@link addTaskWithAutoConnect} and direct callers.
   */
  public addTaskInstance<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(taskClass: ITaskConstructor<I, O, C>, config: C): ITask<I, O, C> {
    const task = new taskClass(
      config,
      this._registry ? { registry: this._registry } : undefined
    );
    const id = this._facade.graph.addTask(task);
    this._facade.events.emit("changed", id);
    return task;
  }

  /**
   * Adds a task with auto-connect to the previous task. Drains pending
   * dataflows queued by `.rename(...)` first, then runs auto-connect
   * against the immediately-previous task plus earlier tasks for any
   * unmatched required inputs.
   */
  public addTaskWithAutoConnect<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(
    taskClass: ITaskConstructor<I, O, C>,
    input: Partial<I> = {},
    config: Partial<C> = {}
  ): Workflow<any, any> {
    this._error = "";

    const parent = getLastTask(this._facade);

    const task = this.addTaskInstance<I, O, C>(taskClass, {
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
        this._facade.graph.addDataflow(dataflow);
      });

      this._dataFlows = [];
    }

    // Auto-connect to parent if needed
    if (parent) {
      // Build the list of earlier tasks (in reverse chronological order)
      const nodes = this._facade.graph.getTasks();
      const parentIndex = nodes.findIndex((n) => n.id === parent.id);
      const earlierTasks: ITask[] = [];
      for (let i = parentIndex - 1; i >= 0; i--) {
        earlierTasks.push(nodes[i]);
      }

      const providedInputKeys = new Set(Object.keys(input || {}));

      // Ports already connected via pending dataflows (e.g., from .rename())
      // must not be re-matched by auto-connect Strategies 1/2/3.
      const connectedInputKeys = new Set(
        this._facade.graph.getSourceDataflows(task.id).map((df) => df.targetTaskPortId)
      );

      const result = autoConnect(this._facade.graph, parent, task, {
        providedInputKeys,
        connectedInputKeys,
        earlierTasks,
      });

      if (result.error) {
        // In loop builder mode, don't remove the task - allow manual connection
        // In normal mode, remove the task since auto-connect is required
        if (this._loopContext !== undefined) {
          this._error = result.error;
          getLogger().warn(this._error);
        } else {
          this._error = result.error + " Task not added.";
          getLogger().error(this._error);
          this._facade.graph.removeTask(task.id);
        }
      }
    }

    // Update InputTask/OutputTask schemas based on connected dataflows
    if (!this._error) {
      updateBoundaryTaskSchemas(this._facade.graph);
    }

    return this._facade;
  }

  /**
   * Adds an iterator/loop task to the workflow using the same auto-connect
   * logic as {@link addTaskWithAutoConnect}, then returns a new loop-builder
   * Workflow whose template graph the user populates.
   */
  public addLoopTask<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig<I> = TaskConfig<I>,
  >(taskClass: ITaskConstructor<I, O, C>, config: Partial<C> = {}): Workflow<I, O> {
    this._error = "";

    const parent = getLastTask(this._facade);

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

    const task = this.addTaskInstance<I, O, C>(taskClass, { id: uuid4(), ...resolvedConfig } as C);

    // Process any pending data flows (same as addTaskWithAutoConnect)
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
        this._facade.graph.addDataflow(dataflow);
      });

      this._dataFlows = [];
    }

    // Defer auto-connect until endMap/endReduce/endWhile, when the iterator task
    // has its template graph populated and its dynamic inputSchema is available.
    // Store the pending context on the loop builder workflow.
    const FacadeCtor = this._facade.constructor as new (
      cache?: ReturnType<Workflow["outputCache"]>,
      parent?: Workflow,
      iteratorTask?: GraphAsTask,
      registry?: ServiceRegistry
    ) => Workflow<any, any>;

    const loopBuilder = new FacadeCtor(
      this._facade.outputCache(),
      this._facade,
      task as unknown as GraphAsTask,
      this._registry
    ) as unknown as Workflow<I, O>;

    if (parent) {
      const childCtx = loopBuilder.builder.loopContext;
      if (childCtx) {
        childCtx.pendingLoopConnect = { parent, iteratorTask: task };
      }
    }
    return loopBuilder;
  }

  /**
   * Connects outputs to inputs between tasks. Validates source/target
   * schemas before adding the dataflow; throws {@link WorkflowError} on
   * mismatch.
   */
  public connect(
    sourceTaskId: unknown,
    sourceTaskPortId: string,
    targetTaskId: unknown,
    targetTaskPortId: string
  ): void {
    const sourceTask = this._facade.graph.getTask(sourceTaskId);
    const targetTask = this._facade.graph.getTask(targetTaskId);

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
    this._facade.graph.addDataflow(dataflow);
  }

  /**
   * Renames an output of a task, queuing a pending dataflow. The dataflow's
   * target is filled in when the next task is added via
   * {@link addTaskWithAutoConnect}.
   */
  public rename(
    source: string,
    target: string,
    indexOrOptions: number | RenameOptions = -1
  ): void {
    this._error = "";

    const index =
      typeof indexOrOptions === "number" ? indexOrOptions : (indexOrOptions.index ?? -1);
    const transforms = typeof indexOrOptions === "number" ? undefined : indexOrOptions.transforms;

    const nodes = this._facade.graph.getTasks();
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
  }

  /**
   * Adds an error handler task that receives errors from the previous task.
   * The handler task is wired from the previous task's `[error]` output port
   * to its all-ports input.
   */
  public onError(handler: Taskish): void {
    this._error = "";

    const parent = getLastTask(this._facade);
    if (!parent) {
      this._error = "onError() requires a preceding task in the workflow";
      getLogger().error(this._error);
      throw new WorkflowError(this._error);
    }

    const handlerTask = ensureTask(handler);
    this._facade.graph.addTask(handlerTask);

    // Connect the previous task's error output port to the handler's all-ports input
    const dataflow = new Dataflow(
      parent.id,
      DATAFLOW_ERROR_PORT,
      handlerTask.id,
      DATAFLOW_ALL_PORTS
    );
    this._facade.graph.addDataflow(dataflow);
    this._facade.events.emit("changed", handlerTask.id);
  }

  /** Removes the last task from the graph. */
  public pop(): void {
    this._error = "";
    const nodes = this._facade.graph.getTasks();

    if (nodes.length === 0) {
      this._error = "No tasks to remove";
      getLogger().error(this._error);
      return;
    }

    const lastNode = nodes[nodes.length - 1];
    this._facade.graph.removeTask(lastNode.id);
  }

  /** Opens a conditional branch builder rooted at the facade. */
  public createConditional(condition: ConditionFn<TaskInput>): ConditionalBuilder {
    return new ConditionalBuilder(this._facade, condition);
  }
}

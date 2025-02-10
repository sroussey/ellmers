//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { GraphEvents } from "@sroussey/typescript-graph";
import { DataFlow, TaskGraph, TaskGraphJson } from "./TaskGraph";
import { TaskGraphRunner } from "./TaskGraphRunner";
import {
  CompoundTask,
  SingleTask,
  TaskBase,
  TaskInput,
  TaskInputDefinition,
  TaskOutputDefinition,
} from "./Task";
import { TaskOutputRepository } from "../../storage/taskoutput/TaskOutputRepository";
import { JsonTaskItem } from "../JsonTask";

export type TaskGraphBuilderHelper<I extends TaskInput> = (input?: Partial<I>) => TaskGraphBuilder;

let id = 0;

export function TaskGraphBuilderHelper<I extends TaskInput>(
  taskClass: typeof CompoundTask | typeof SingleTask
) {
  const result = function (this: TaskGraphBuilder, input?: Partial<I>): TaskGraphBuilder {
    this._error = "";
    const nodes = this.graph.getNodes();
    const parent = nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
    id++;
    const task = new taskClass({ id: String(id), input });
    this.graph.addTask(task);
    if (this._dataFlows.length > 0) {
      this._dataFlows.forEach((dataFlow) => {
        if (task.inputs.find((i) => i.id === dataFlow.targetTaskInputId) === undefined) {
          this._error = `Input ${dataFlow.targetTaskInputId} not found on task ${task.config.id}`;
          console.error(this._error);
          return this;
        }
        dataFlow.targetTaskId = task.config.id;
        this.graph.addDataFlow(dataFlow);
      });
      this._dataFlows = [];
    }
    if (parent && this.graph.outEdges(parent.config.id).length === 0) {
      // find matches between parent outputs and task inputs based on valueType
      const matches = new Map<string, string>();

      const makeMatch = (
        comparator: (output: TaskOutputDefinition, input: TaskInputDefinition) => boolean
      ) => {
        for (const parentOutput of parent.outputs) {
          for (const taskInput of task.inputs) {
            if (!matches.has(taskInput.id) && comparator(parentOutput, taskInput)) {
              matches.set(taskInput.id, parentOutput.id);
              const df = new DataFlow(
                parent.config.id,
                parentOutput.id,
                task.config.id,
                taskInput.id
              );
              this.graph.addDataFlow(df);
            }
          }
        }
        return matches;
      };
      // make some educated guesses about how to connect the parent to the task, since the user didn't specify
      makeMatch((output, input) => output.valueType === input.valueType && output.id === input.id);
      makeMatch(
        (output, input) =>
          output.valueType === input.valueType && output.id === "output" && input.id === "input"
      );
      makeMatch((output, input) => output.valueType === input.valueType);
      if (matches.size === 0) {
        this._error = `Could not find a match between the outputs of ${
          (parent.constructor as any).type
        } and the inputs of ${
          (task.constructor as any).type
        }. You now need to connect the outputs to the inputs via connect() manually before adding this task. Task not added.`;
        console.error(this._error);
        this.graph.removeNode(task.config.id);
      }
    }
    return this;
  };
  // @ts-expect-error - runtype is hack from ArrayTask TODO: fix
  result.type = taskClass.runtype ?? taskClass.type;
  result.inputs = taskClass.inputs;
  result.outputs = taskClass.outputs;
  return result;
}

type BuilderEvents = GraphEvents | "changed" | "reset" | "error" | "start" | "complete";

/**
 * Class for building and managing a task graph
 * Provides methods for adding tasks, connecting outputs to inputs, and running the task graph
 */
export class TaskGraphBuilder {
  private _graph: TaskGraph = new TaskGraph();
  private _runner: TaskGraphRunner;
  _error: string = "";
  _repository?: TaskOutputRepository;

  public get graph(): TaskGraph {
    return this._graph;
  }
  public set graph(value: TaskGraph) {
    this._dataFlows = [];
    this._error = "";
    this.clearEvents();
    this._graph = value;
    this._runner = new TaskGraphRunner(this._graph, this._repository);
    this.setupEvents();
    this.events.emit("reset");
  }

  events = new EventEmitter<BuilderEvents>();
  on(name: BuilderEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }
  off(name: BuilderEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }
  emit(name: BuilderEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
  }

  constructor(repository?: TaskOutputRepository) {
    this._repository = repository;
    this._runner = new TaskGraphRunner(this._graph, this._repository);
    this._onChanged = this._onChanged.bind(this);
    this.setupEvents();
  }

  _onChanged(id: unknown) {
    this.emit("changed", id);
  }

  setupEvents() {
    this._graph.events.on("node-added", this._onChanged);
    this._graph.events.on("node-replaced", this._onChanged);
    this._graph.events.on("node-removed", this._onChanged);
    this._graph.events.on("edge-added", this._onChanged);
    this._graph.events.on("edge-replaced", this._onChanged);
    this._graph.events.on("edge-removed", this._onChanged);
  }

  clearEvents() {
    this._graph.events.off("node-added", this._onChanged);
    this._graph.events.off("node-replaced", this._onChanged);
    this._graph.events.off("node-removed", this._onChanged);
    this._graph.events.off("edge-added", this._onChanged);
    this._graph.events.off("edge-replaced", this._onChanged);
    this._graph.events.off("edge-removed", this._onChanged);
  }

  /**
   * Runs the task graph
   * @returns The output of the task graph
   */
  async run() {
    this.emit("start");
    try {
      const out = await this._runner.runGraph();
      this.emit("complete");
      return out;
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Removes the last task from the task graph
   * @returns The current task graph builder
   */
  pop() {
    this._error = "";
    const nodes = this._graph.getNodes();
    if (nodes.length === 0) {
      this._error = "No tasks to remove";
      console.error(this._error);
    }
    const lastNode = nodes[nodes.length - 1];
    this._graph.removeNode(lastNode.config.id);
    return this;
  }

  toJSON(): TaskGraphJson {
    return this._graph.toJSON();
  }

  toDependencyJSON(): JsonTaskItem[] {
    return this._graph.toDependencyJSON();
  }

  /**
   * Creates a new task graph builder that runs multiple task graph builders in parallel
   * @param args The task graph builders to run in parallel
   * @returns The current task graph builder
   */
  parallel(...args: Array<(b: TaskGraphBuilder) => void>) {
    this._error = "";
    const group = new TaskGraphBuilder();
    for (const fn of args) {
      fn(group);
    }
    const groupTask = new CompoundTask({ input: {} });
    groupTask.subGraph = group._graph;
    this._graph.addTask(groupTask);
    return this;
  }

  _dataFlows: DataFlow[] = [];
  /**
   * Renames an output of a task to a new target input
   * @param source The id of the output to rename
   * @param target The id of the input to rename to
   * @param index The index of the task to rename the output of, defaults to the last task
   * @returns The current task graph builder
   */
  rename(source: string, target: string, index: number = -1) {
    this._error = "";
    const nodes = this._graph.getNodes();
    if (-index > nodes.length) {
      this._error = `Back index greater than number of tasks`;
      throw new Error(this._error);
    }
    const lastNode = nodes[nodes.length + index];
    const sourceTaskOutputs = (lastNode?.constructor as typeof TaskBase)?.outputs;
    if (!sourceTaskOutputs.find((o) => o.id === source)) {
      this._error = `Output ${source} not found on task ${lastNode.config.id}`;
      throw new Error(this._error);
    }
    this._dataFlows.push(new DataFlow(lastNode.config.id, source, undefined, target));
    return this;
  }

  /**
   * Resets the task graph builder to its initial state
   * @returns The current task graph builder
   */
  reset() {
    id = 0;
    this.clearEvents();
    this._graph = new TaskGraph();
    this._runner = new TaskGraphRunner(this._graph, this._repository);
    this._dataFlows = [];
    this._error = "";
    this.setupEvents();
    this.events.emit("changed");
    this.events.emit("reset");
    return this;
  }
}

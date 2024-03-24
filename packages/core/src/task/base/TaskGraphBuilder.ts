//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { DataFlow, TaskGraph } from "task/base/TaskGraph";
import { TaskGraphRunner } from "./TaskGraphRunner";
import { CompoundTask, SingleTask, TaskBase, TaskInput } from "./Task";
import { TaskInputDefinition, TaskOutputDefinition } from "./TaskIOTypes";

export type TaskGraphBuilderHelper<I extends TaskInput> = (input?: Partial<I>) => TaskGraphBuilder;

export function TaskGraphBuilderHelper<I extends TaskInput>(
  taskClass: typeof CompoundTask | typeof SingleTask
) {
  return function (this: TaskGraphBuilder, input?: Partial<I>): TaskGraphBuilder {
    const nodes = this._graph.getNodes();
    const parent = nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
    const task = new taskClass({ input });
    this._graph.addTask(task);
    if (this._dataFlows.length > 0) {
      this._dataFlows.forEach((dataFlow) => {
        if (taskClass.inputs.find((i) => i.id === dataFlow.targetTaskInputId) === undefined) {
          throw new Error(
            `Input ${dataFlow.targetTaskInputId} not found on task ${task.config.id}`
          );
        }
        dataFlow.targetTaskId = task.config.id;
        this._graph.addDataFlow(dataFlow);
      });
      this._dataFlows = [];
    }
    if (parent && this._graph.outEdges(parent.config.id).length === 0) {
      const parentOutputs = (parent.constructor as typeof TaskBase).outputs;
      const taskInputs = (task.constructor as typeof TaskBase).inputs;
      // find matches between parent outputs and task inputs based on valueType
      const matches = new Map<string, string>();

      const makeMatch = (
        comparator: (output: TaskOutputDefinition, input: TaskInputDefinition) => boolean
      ) => {
        for (const parentOutput of parentOutputs) {
          for (const taskInput of taskInputs) {
            if (!matches.has(taskInput.id) && comparator(parentOutput, taskInput)) {
              matches.set(taskInput.id, parentOutput.id);
              const df = new DataFlow(
                parent.config.id,
                parentOutput.id,
                task.config.id,
                taskInput.id
              );
              this._graph.addDataFlow(df);
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
        console.warn(
          `Could not find a match between the outputs of ${
            (parent.constructor as any).type
          } and the inputs of ${(parent.constructor as any).type}. You now need to specify the inputs manually.`
        );
      }
    }
    return this;
  };
}

export class TaskGraphBuilder {
  _graph: TaskGraph;
  _runner: TaskGraphRunner;

  constructor() {
    this._graph = new TaskGraph();
    this._runner = new TaskGraphRunner(this._graph);
  }

  async run() {
    return this._runner.runGraph();
  }

  parallel(...args: Array<(b: TaskGraphBuilder) => void>) {
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
  connect(source: string, target: string) {
    const nodes = this._graph.getNodes();
    const lastNode = nodes[nodes.length - 1];
    const sourceTaskOutputs = (lastNode.constructor as typeof TaskBase).outputs;
    if (!sourceTaskOutputs.find((o) => o.id === source)) {
      throw new Error(`Output ${source} not found on task ${lastNode.config.id}`);
    }
    this._dataFlows.push(new DataFlow(lastNode.config.id, source, undefined, target));
    return this;
  }
}

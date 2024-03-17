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

export type TaskGraphBuilderHelper<I extends TaskInput> = (input: Partial<I>) => void;

export function TaskGraphBuilderHelper<I extends TaskInput>(
  taskClass: typeof CompoundTask | typeof SingleTask
) {
  return function (this: TaskGraphBuilder, input: Partial<I>) {
    const nodes = this._graph.getNodes();
    const parent = nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
    const task = new taskClass({ input });
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
              this._graph.addDataFlow(
                new DataFlow(parent.config.id, parentOutput.id, task.config.id, taskInput.id)
              );
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
        throw new Error(
          `Could not find a match between the outputs of ${
            (parent.constructor as any).type
          } and the inputs of ${(parent.constructor as any).type}`
        );
      }
    }
    this._graph.addTask(task);
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
    groupTask._subGraph = group._graph;
    this._graph.addTask(groupTask);
  }
}

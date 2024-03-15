//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraph } from "task/base/TaskGraph";
import { TaskGraphRunner } from "./TaskGraphRunner";

export function TaskGraphBuilderHelper(fn: Function) {
  return function (this: TaskGraphBuilder, input: any) {
    const task = fn(input);
    this._graph.addTask(task);
    return task;
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
    console.log("TaskGraphBuilder.run");
    return this._runner.runGraph();
  }
}

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Task, TaskInput, TaskOutput } from "./Task";
import { DirectedAcyclicGraph } from "@sroussey/typescript-graph";

class Transfer {
  input?: TaskInput;
  output?: TaskOutput;
}
type FlowGraph = DirectedAcyclicGraph<Task, Transfer>;

export class Flow {
  #graph: FlowGraph;
  constructor() {
    this.#graph = new DirectedAcyclicGraph<Task, Transfer>(
      (task) => task.config.id
    );
  }
  addTask(task: Task) {
    this.#graph.insert(task);
  }
  getTasks(): Task[] {
    return this.#graph.topologicallySortedNodes();
  }
  removeTask(task: Task) {
    this.#graph.remove(task.config.id);
  }
  addTransfer(from: Task, to: Task, edge: Transfer) {
    this.#graph.addEdge(from.config.id, to.config.id, edge);
  }
  removeTransfer(from: Task, to: Task) {
    this.#graph.removeEdge(from.config.id, to.config.id);
  }
}

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, Task, TaskOutput } from "task/Task";
import { TaskGraph } from "task/TaskGraph";

export class TaskGraphRunner {
  public layers: Map<number, Task[]>;

  constructor(public dag: TaskGraph) {
    this.dag = dag;
    this.layers = new Map();
  }

  public assignLayers(sortedNodes: Task[]) {
    this.layers = new Map();
    const nodeToLayer = new Map<string, number>();

    sortedNodes.forEach((node, _index) => {
      let maxLayer = -1;

      // Get all incoming edges (dependencies) of the node
      const incomingEdges = this.dag.inEdges(node.config.id).map(([from]) => from);

      incomingEdges.forEach((from) => {
        // Find the layer of the dependency
        const layer = nodeToLayer.get(from);
        if (layer !== undefined) {
          maxLayer = Math.max(maxLayer, layer);
        }
      });

      // Assign the node to the next layer after the maximum layer of its dependencies
      const assignedLayer = maxLayer + 1;
      nodeToLayer.set(node.config.id, assignedLayer);

      if (!this.layers.has(assignedLayer)) {
        this.layers.set(assignedLayer, []);
      }

      this.layers.get(assignedLayer)?.push(node);
    });
  }

  private copyInputFromEdgesToNode(node: Task) {
    this.dag.inEdges(node.config.id).forEach(([, , dataFlow]) => {
      if (dataFlow.value !== undefined) {
        const toInput: TaskInput = {};
        toInput[dataFlow.targetTaskInputId] = dataFlow.value;
        node.addInputData(toInput);
      }
    });
  }

  private pushOutputFromNodeToEdges(node: Task, results: TaskOutput) {
    this.dag.outEdges(node.config.id).forEach(([, , dataFlow]) => {
      if (results[dataFlow.sourceTaskOutputId] !== undefined) {
        dataFlow.value = results[dataFlow.sourceTaskOutputId];
      }
    });
  }

  private async runTasksAsync() {
    let results: TaskOutput[] = [];
    for (const [layerNumber, nodes] of this.layers.entries()) {
      const layerPromises = nodes.map(async (node) => {
        this.copyInputFromEdgesToNode(node);
        const results = await node.run();
        this.pushOutputFromNodeToEdges(node, results);
        return results;
      });
      results = await Promise.allSettled(layerPromises);
      // note that the results array may contain undefined values due to errors and rejected promises
      results = results.map((r) => r.value);
    }
    return results;
  }

  private runTasksSync() {
    let results: TaskOutput[] = [];
    for (const [_layerNumber, nodes] of this.layers.entries()) {
      results = nodes.map((node) => {
        this.copyInputFromEdgesToNode(node);
        const results = node.runSyncOnly();
        this.pushOutputFromNodeToEdges(node, results);
        return results;
      });
    }
    return results;
  }

  public async runGraph() {
    this.dag.getNodes().forEach((node) => node.resetInputData());
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    return await this.runTasksAsync();
  }

  public runGraphSyncOnly() {
    this.dag.getNodes().forEach((node) => node.resetInputData());
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    return this.runTasksSync();
  }
}

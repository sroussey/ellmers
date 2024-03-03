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

  private async runTasksAsync() {
    let results: TaskOutput[] = [];
    for (const [layerNumber, nodes] of this.layers.entries()) {
      const layerPromises = nodes.map(async (node) => {
        const results = await node.run();
        this.dag.outEdges(node.config.id).forEach(([, , dataFlow]) => {
          const toInput: TaskInput = {};
          const targetNode = this.dag.getNode(dataFlow.targetTaskId);
          if (results[dataFlow.sourceTaskOutputId] !== undefined)
            toInput[dataFlow.targetTaskInputId] = results[dataFlow.sourceTaskOutputId];
          targetNode!.addInputData(toInput);
        });
        return results;
      });
      results = await Promise.allSettled(layerPromises);
      results = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    }
    return results;
  }

  private runTasksSync() {
    let results: TaskOutput[] = [];
    for (const [_layerNumber, nodes] of this.layers.entries()) {
      results = nodes.map((node) => {
        const results = node.runSyncOnly();
        this.dag.outEdges(node.config.id).forEach(([, , dataFlow]) => {
          const toInput: TaskInput = {};
          const targetNode = this.dag.getNode(dataFlow.targetTaskId);
          if (results[dataFlow.sourceTaskOutputId] !== undefined)
            toInput[dataFlow.targetTaskInputId] = results[dataFlow.sourceTaskOutputId];
          targetNode!.addInputData(toInput);
        });
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

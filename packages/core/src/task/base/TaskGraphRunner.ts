//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ITaskOutputRepository } from "storage/ITaskOutputRepository";
import { TaskInput, Task, TaskOutput } from "task/base/Task";
import { TaskGraph } from "task/base/TaskGraph";

export class TaskGraphRunner {
  public layers: Map<number, Task[]>;
  public provenanceInput: Map<unknown, TaskInput>;

  constructor(
    public dag: TaskGraph,
    public repository?: ITaskOutputRepository
  ) {
    this.layers = new Map();
    this.provenanceInput = new Map();
  }

  public assignLayers(sortedNodes: Task[]) {
    this.layers = new Map();
    const nodeToLayer = new Map<unknown, number>();

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
    this.dag.getSourceDataFlows(node.config.id).forEach((dataFlow) => {
      const toInput: TaskInput = {};
      toInput[dataFlow.targetTaskInputId] = dataFlow.value;
      node.addInputData(toInput);
    });
  }

  private getInputProvenance(node: Task): TaskInput {
    const nodeProvenance: TaskInput = {};
    this.dag.getSourceDataFlows(node.config.id).forEach((dataFlow) => {
      Object.assign(nodeProvenance, dataFlow.provenance);
    });
    return nodeProvenance;
  }

  private pushOutputFromNodeToEdges(node: Task, results: TaskOutput, nodeProvenance?: TaskInput) {
    this.dag.getTargetDataFlows(node.config.id).forEach((dataFlow) => {
      if (results[dataFlow.sourceTaskOutputId] !== undefined) {
        dataFlow.value = results[dataFlow.sourceTaskOutputId];
      }
      if (nodeProvenance) dataFlow.provenance = nodeProvenance;
    });
  }

  private async runTaskWithProvenance(
    task: Task,
    parentProvenance: TaskInput
  ): Promise<TaskOutput> {
    // Update provenance for the current task
    const nodeProvenance = {
      ...parentProvenance,
      ...this.getInputProvenance(task),
      ...task.getProvenance(),
    };
    this.provenanceInput.set(task.config.id, nodeProvenance);
    this.copyInputFromEdgesToNode(task);

    let results = await this.repository?.getOutput(
      (task.constructor as any).type,
      task.runInputData
    );
    if (!results) {
      results = await task.run(nodeProvenance);
    }

    this.pushOutputFromNodeToEdges(task, results, nodeProvenance);
    return results;
  }

  public async runGraph(parentProvenance: TaskInput = {}) {
    this.provenanceInput = new Map();
    this.dag.getNodes().forEach((node) => node.resetInputData());
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    let results: TaskOutput[] = [];
    for (const [layerNumber, nodes] of this.layers.entries()) {
      results = await Promise.allSettled(
        nodes.map((node) =>
          this.runTaskWithProvenance(node, layerNumber == 0 ? parentProvenance : {})
        )
      );
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

  public runGraphSyncOnly() {
    this.dag.getNodes().forEach((node) => node.resetInputData());
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    return this.runTasksSync();
  }
}

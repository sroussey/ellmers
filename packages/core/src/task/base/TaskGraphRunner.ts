//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskOutputRepository } from "../../storage/taskoutput/TaskOutputRepository";
import { TaskInput, Task, TaskOutput, TaskStatus } from "./Task";
import { TaskGraph } from "./TaskGraph";
import { nanoid } from "nanoid";

/**
 * Class for running a task graph
 * Manages the execution of tasks in a task graph, including provenance tracking and caching
 */
export class TaskGraphRunner {
  /**
   * Map of layers, where each layer contains an array of tasks
   * @type {Map<number, Task[]>}
   */
  public layers: Map<number, Task[]>;

  /**
   * Map of provenance input for each task
   * @type {Map<unknown, TaskInput>}
   */
  public provenanceInput: Map<unknown, TaskInput>;

  /**
   * Constructor for TaskGraphRunner
   * @param dag The task graph to run
   * @param repository The task output repository to use for caching task outputs
   */
  constructor(
    public dag: TaskGraph,
    public repository?: TaskOutputRepository
  ) {
    this.layers = new Map();
    this.provenanceInput = new Map();
  }

  /**
   * Assigns layers to tasks based on their dependencies. Each layer is a set of tasks
   * that can be run in parallel as a set, the next layer is run after the previous layer has completed.
   * @param sortedNodes The topologically sorted list of tasks
   */
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

  /**
   * Retrieves the provenance input for a task
   * @param node The task to retrieve provenance input for
   * @returns The provenance input for the task
   */
  private getInputProvenance(node: Task): TaskInput {
    const nodeProvenance: TaskInput = {};
    this.dag.getSourceDataFlows(node.config.id).forEach((dataFlow) => {
      Object.assign(nodeProvenance, dataFlow.provenance);
    });
    return nodeProvenance;
  }

  /**
   * Pushes the output of a task to its target tasks
   * @param node The task that produced the output
   * @param results The output of the task
   * @param nodeProvenance The provenance input for the task
   */
  private pushOutputFromNodeToEdges(node: Task, results: TaskOutput, nodeProvenance?: TaskInput) {
    this.dag.getTargetDataFlows(node.config.id).forEach((dataFlow) => {
      if (results[dataFlow.sourceTaskOutputId] !== undefined) {
        dataFlow.value = results[dataFlow.sourceTaskOutputId];
      }
      if (nodeProvenance) dataFlow.provenance = nodeProvenance;
    });
  }

  /**
   * Runs a task with provenance input
   * @param task The task to run
   * @param parentProvenance The provenance input for the task
   * @returns The output of the task
   */
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

    const shouldUseRepository = !(task.constructor as any).sideeffects && !task.isCompound;

    let results;

    if (shouldUseRepository) {
      results = await this.repository?.getOutput((task.constructor as any).type, task.runInputData);
      if (results) {
        task.emit("start");
        task.emit("progress", 100, Object.values(results)[0]);
        task.runOutputData = results;
        await task.runReactive();
        task.emit("complete");
      }
    }
    if (!results) {
      results = await task.run(nodeProvenance, this.repository);
      if (shouldUseRepository) {
        await this.repository?.saveOutput(
          (task.constructor as any).type,
          task.runInputData,
          results
        );
      }
    }

    this.pushOutputFromNodeToEdges(task, results, nodeProvenance);
    return results;
  }

  /**
   * Runs the task graph
   * @param parentProvenance The provenance input for the task graph
   * @returns The output of the task graph
   */
  public async runGraph(parentProvenance: TaskInput = {}) {
    const taskRunId = nanoid();
    this.dag.getNodes().forEach((node) => {
      if (node.config) {
        // @ts-ignore
        node.config.currentJobRunId = taskRunId;
      }
      node.resetInputData();
    });
    this.provenanceInput = new Map();
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);

    let results: TaskOutput[] = [];
    for (const [layerNumber, nodes] of this.layers.entries()) {
      const settledResults = await Promise.allSettled(
        nodes.map((node) =>
          this.runTaskWithProvenance(node, layerNumber === 0 ? parentProvenance : {})
        )
      );

      for (const result of settledResults) {
        if (result.status === "rejected") {
          // Abort tasks that support aborting by calling their abort method
          await Promise.all(
            this.dag.getNodes().map(async (node: Task) => {
              if ([TaskStatus.PROCESSING].includes(node.status)) {
                await node.abort();
              }
              if ([TaskStatus.PENDING].includes(node.status)) {
                node.emit("error", "Aborted");
              }
            })
          );
          throw new Error(
            `Task graph aborted due to error in layer ${layerNumber}: ${result.reason}`
          );
        }
      }

      results = settledResults
        .filter((r): r is PromiseFulfilledResult<TaskOutput> => r.status === "fulfilled") //ts
        .map((r) => r.value);
    }
    return results;
  }

  /**
   * Runs the task graph in a reactive manner
   * @returns The output of the task graph
   */
  private async runTasksReactive() {
    let results: TaskOutput[] = [];
    for (const [_layerNumber, nodes] of this.layers.entries()) {
      const settledResults = await Promise.allSettled(
        nodes.map(async (node) => {
          this.copyInputFromEdgesToNode(node);
          const results = await node.runReactive();
          this.pushOutputFromNodeToEdges(node, results);
          return results;
        })
      );
      results = settledResults.map((r) => (r.status === "fulfilled" ? r.value : {}));
    }
    return results;
  }

  /**
   * Runs the task graph in a reactive manner
   * @returns The output of the task graph
   */
  public async runGraphReactive() {
    this.dag.getNodes().forEach((node) => node.resetInputData());
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    return await this.runTasksReactive();
  }
}

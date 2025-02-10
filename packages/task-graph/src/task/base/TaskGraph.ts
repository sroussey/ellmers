//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { DirectedAcyclicGraph } from "@sroussey/typescript-graph";
import { TaskIdType, TaskInput, TaskOutput } from "./Task";
import { Task, TaskStream } from "./Task";
import type { JsonTaskItem } from "../JsonTask";

export type DataFlowIdType = string;

/**
 * Represents a data flow between two tasks, indicating how one task's output is used as input for another task
 */
export class DataFlow {
  constructor(
    public sourceTaskId: TaskIdType,
    public sourceTaskOutputId: string,
    public targetTaskId: TaskIdType,
    public targetTaskInputId: string
  ) {}
  get id(): string {
    return `${this.sourceTaskId}.${this.sourceTaskOutputId} -> ${this.targetTaskId}.${this.targetTaskInputId}`;
  }
  public value: TaskOutput = {};
  public provenance: TaskInput = {};

  toJSON(): DataFlowJson {
    return {
      sourceTaskId: this.sourceTaskId,
      sourceTaskOutputId: this.sourceTaskOutputId,
      targetTaskId: this.targetTaskId,
      targetTaskInputId: this.targetTaskInputId,
    };
  }
}

/**
 * Represents a task graph item, which can be a task or a subgraph
 */
export type TaskGraphItemJson = {
  id: unknown;
  type: string;
  name?: string;
  input?: TaskInput;
  provenance?: TaskInput;
  subgraph?: TaskGraphJson;
};

export type TaskGraphJson = {
  nodes: TaskGraphItemJson[];
  edges: DataFlowJson[];
};

export type DataFlowJson = {
  sourceTaskId: unknown;
  sourceTaskOutputId: string;
  targetTaskId: unknown;
  targetTaskInputId: string;
};

/**
 * Represents a task graph, a directed acyclic graph of tasks and data flows
 */
export class TaskGraph extends DirectedAcyclicGraph<Task, DataFlow, TaskIdType, DataFlowIdType> {
  constructor() {
    super(
      (task: Task) => task.config.id,
      (dataFlow: DataFlow) => dataFlow.id
    );
  }

  /**
   * Retrieves a task from the task graph by its id
   * @param id The id of the task to retrieve
   * @returns The task with the given id, or undefined if not found
   */
  public getTask(id: TaskIdType): Task | undefined {
    return super.getNode(id);
  }

  /**
   * Adds a task to the task graph
   * @param task The task to add
   * @returns The current task graph
   */
  public addTask(task: Task) {
    return super.addNode(task);
  }

  /**
   * Adds multiple tasks to the task graph
   * @param tasks The tasks to add
   * @returns The current task graph
   */
  public addTasks(tasks: Task[]) {
    return super.addNodes(tasks);
  }

  /**
   * Adds a data flow to the task graph
   * @param dataflow The data flow to add
   * @returns The current task graph
   */
  public addDataFlow(dataflow: DataFlow) {
    return super.addEdge(dataflow.sourceTaskId, dataflow.targetTaskId, dataflow);
  }

  /**
   * Adds multiple data flows to the task graph
   * @param dataflows The data flows to add
   * @returns The current task graph
   */
  public addDataFlows(dataflows: DataFlow[]) {
    const addedEdges = dataflows.map<[s: unknown, t: unknown, e: DataFlow]>((edge) => {
      return [edge.sourceTaskId, edge.targetTaskId, edge];
    });
    return super.addEdges(addedEdges);
  }

  /**
   * Retrieves a data flow from the task graph by its id
   * @param id The id of the data flow to retrieve
   * @returns The data flow with the given id, or undefined if not found
   */
  public getDataFlow(id: DataFlowIdType): DataFlow | undefined {
    for (const i in this.adjacency) {
      for (const j in this.adjacency[i]) {
        const maybeEdges = this.adjacency[i][j];
        if (maybeEdges !== null) {
          for (const edge of maybeEdges) {
            if (this.edgeIdentity(edge, "", "") == id) {
              return edge;
            }
          }
        }
      }
    }
  }
  public getDataFlows(): DataFlow[] {
    return this.getEdges().map((edge) => edge[2]);
  }

  /**
   * Retrieves the data flows that are sources of a given task
   * @param taskId The id of the task to retrieve sources for
   * @returns An array of data flows that are sources of the given task
   */
  public getSourceDataFlows(taskId: unknown): DataFlow[] {
    return this.inEdges(taskId).map(([, , dataFlow]) => dataFlow);
  }

  /**
   * Retrieves the data flows that are targets of a given task
   * @param taskId The id of the task to retrieve targets for
   * @returns An array of data flows that are targets of the given task
   */
  public getTargetDataFlows(taskId: unknown): DataFlow[] {
    return this.outEdges(taskId).map(([, , dataFlow]) => dataFlow);
  }

  /**
   * Retrieves the tasks that are sources of a given task
   * @param taskId The id of the task to retrieve sources for
   * @returns An array of tasks that are sources of the given task
   */
  public getSourceTasks(taskId: unknown): Task[] {
    return this.getSourceDataFlows(taskId).map((dataFlow) => this.getNode(dataFlow.sourceTaskId)!);
  }

  /**
   * Retrieves the tasks that are targets of a given task
   * @param taskId The id of the task to retrieve targets for
   * @returns An array of tasks that are targets of the given task
   */
  public getTargetTasks(taskId: unknown): Task[] {
    return this.getTargetDataFlows(taskId).map((dataFlow) => this.getNode(dataFlow.targetTaskId)!);
  }

  /**
   * Converts the task graph to a JSON format suitable for dependency tracking
   * @returns An array of JsonTaskItem objects, each representing a task and its dependencies
   */
  public toJSON(): TaskGraphJson {
    const nodes = this.getNodes().map((node) => node.toJSON());
    const edges = this.getDataFlows().map((df) => df.toJSON());
    return {
      nodes,
      edges,
    };
  }

  /**
   * Converts the task graph to a JSON format suitable for dependency tracking
   * @returns An array of JsonTaskItem objects, each representing a task and its dependencies
   */
  public toDependencyJSON(): JsonTaskItem[] {
    const nodes = this.getNodes().flatMap((node) => node.toDependencyJSON());
    this.getDataFlows().forEach((edge) => {
      const target = nodes.find((node) => node.id === edge.targetTaskId)!;
      if (!target.dependencies) {
        target.dependencies = {};
      }
      const targetDeps = target.dependencies[edge.targetTaskInputId];
      if (!targetDeps) {
        target.dependencies[edge.targetTaskInputId] = {
          id: edge.sourceTaskId,
          output: edge.sourceTaskOutputId,
        };
      } else {
        if (Array.isArray(targetDeps)) {
          targetDeps.push({
            id: edge.sourceTaskId,
            output: edge.sourceTaskOutputId,
          });
        } else {
          target.dependencies[edge.targetTaskInputId] = [
            targetDeps,
            { id: edge.sourceTaskId, output: edge.sourceTaskOutputId },
          ];
        }
      }
    });
    return nodes;
  }
}

/**
 * Super simple helper if you know the input and output handles, and there is only one each
 *
 * @param tasks TaskStream
 * @param inputHandle  TaskIdType
 * @param outputHandle TaskIdType
 * @returns
 */
function serialGraphEdges(
  tasks: TaskStream,
  inputHandle: string,
  outputHandle: string
): DataFlow[] {
  const edges: DataFlow[] = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    edges.push(new DataFlow(tasks[i].config.id, inputHandle, tasks[i + 1].config.id, outputHandle));
  }
  return edges;
}

/**
 * Super simple helper if you know the input and output handles, and there is only one each
 *
 * @param tasks TaskStream
 * @param inputHandle  TaskIdType
 * @param outputHandle TaskIdType
 * @returns
 */
export function serialGraph(
  tasks: TaskStream,
  inputHandle: string,
  outputHandle: string
): TaskGraph {
  const graph = new TaskGraph();
  graph.addTasks(tasks);
  graph.addDataFlows(serialGraphEdges(tasks, inputHandle, outputHandle));
  return graph;
}

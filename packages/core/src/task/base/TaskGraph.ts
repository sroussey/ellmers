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

export class TaskGraph extends DirectedAcyclicGraph<Task, DataFlow, TaskIdType, DataFlowIdType> {
  constructor() {
    super(
      (task: Task) => task.config.id,
      (dataFlow: DataFlow) => dataFlow.id
    );
  }
  public getTask(id: TaskIdType): Task | undefined {
    return super.getNode(id);
  }
  public addTask(task: Task) {
    return super.addNode(task);
  }
  public addTasks(tasks: Task[]) {
    return super.addNodes(tasks);
  }
  public addDataFlow(dataflow: DataFlow) {
    return super.addEdge(dataflow.sourceTaskId, dataflow.targetTaskId, dataflow);
  }
  public addDataFlows(dataflows: DataFlow[]) {
    const addedEdges = dataflows.map<[s: unknown, t: unknown, e: DataFlow]>((edge) => {
      return [edge.sourceTaskId, edge.targetTaskId, edge];
    });
    return super.addEdges(addedEdges);
  }
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

  public getSourceDataFlows(taskId: unknown): DataFlow[] {
    return this.inEdges(taskId).map(([, , dataFlow]) => dataFlow);
  }

  public getTargetDataFlows(taskId: unknown): DataFlow[] {
    return this.outEdges(taskId).map(([, , dataFlow]) => dataFlow);
  }

  public getSourceTasks(taskId: unknown): Task[] {
    return this.getSourceDataFlows(taskId).map((dataFlow) => this.getNode(dataFlow.sourceTaskId)!);
  }

  public getTargetTasks(taskId: unknown): Task[] {
    return this.getTargetDataFlows(taskId).map((dataFlow) => this.getNode(dataFlow.targetTaskId)!);
  }

  public toJSON(): TaskGraphJson {
    const nodes = this.getNodes().map((node) => node.toJSON());
    const edges = this.getDataFlows().map((df) => df.toJSON());
    return {
      nodes,
      edges,
    };
  }

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
  outputHandle: string,
  inputHandle: string
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
  graph.addDataFlows(serialGraphEdges(tasks, outputHandle, inputHandle));
  return graph;
}

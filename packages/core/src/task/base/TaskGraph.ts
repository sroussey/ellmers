//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { DirectedAcyclicGraph } from "@sroussey/typescript-graph";
import { TaskIdType, TaskOutput } from "./Task";
import { Task, TaskStream } from "./Task";

export type IDataFlow = {
  sourceTaskId: TaskIdType;
  sourceTaskOutputId: string;
  targetTaskId: TaskIdType;
  targetTaskInputId: string;
  id: string;
  value: TaskOutput;
};

export type DataFlowIdType = IDataFlow["id"];

export class DataFlow implements IDataFlow {
  constructor(
    public sourceTaskId: TaskIdType,
    public sourceTaskOutputId: string,
    public targetTaskId: TaskIdType,
    public targetTaskInputId: string,
    public id: string = `${sourceTaskId}.${sourceTaskOutputId} -> ${targetTaskId}.${targetTaskInputId}`
  ) {}
  public value: TaskOutput = {};
}

type NodeNodeEdgeTuples = Array<
  [sourceTask: TaskIdType, targetTask: TaskIdType, edge?: IDataFlow | undefined]
>;

export class TaskGraph extends DirectedAcyclicGraph<Task, IDataFlow, TaskIdType, DataFlowIdType> {
  constructor() {
    super(
      (task: Task) => task.config.id,
      (dataFlow: IDataFlow) => dataFlow.id
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
    const addedEdges = dataflows.map<[s: string, t: string, e: IDataFlow]>((edge) => {
      return [edge.sourceTaskId, edge.targetTaskId, edge];
    });
    return super.addEdges(addedEdges);
  }
  public getDataFlow(id: DataFlowIdType): IDataFlow | undefined {
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
  public getDataFlows(): IDataFlow[] {
    return this.getEdges().map((edge) => edge[2]);
  }

  public getSourceDataFlows(taskId: string): DataFlow[] {
    return this.inEdges(taskId).map(([, , dataFlow]) => dataFlow);
  }

  public getTargetDataFlows(taskId: string): DataFlow[] {
    return this.outEdges(taskId).map(([, , dataFlow]) => dataFlow);
  }

  public getSourceTasks(taskId: string): Task[] {
    return this.getSourceDataFlows(taskId).map((dataFlow) => this.getNode(dataFlow.sourceTaskId)!);
  }

  public getTargetTasks(taskId: string): Task[] {
    return this.getTargetDataFlows(taskId).map((dataFlow) => this.getNode(dataFlow.targetTaskId)!);
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
): IDataFlow[] {
  const edges: IDataFlow[] = [];
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

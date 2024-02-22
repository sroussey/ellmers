//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Listr, ListrTask, PRESET_TIMER } from "listr2";
import { Observable } from "rxjs";
import {
  type TaskStream,
  TaskStatus,
  sleep,
  TaskGraph,
  TaskGraphRunner,
  type Task,
  DataFlow,
  TaskInputDefinition,
} from "ellmers-core";
import { createBar } from "./TaskHelper";

type TaskTree = {
  task: Task;
  children?: TaskTree;
}[];

/**
 * Convert the DAG to a tree for use in a UI like listr2
 * Obviously a DAG can't be turned into a tree, but we can
 * skip some edges and make it look like a tree if we want
 */
function convertToTree(runner: TaskGraphRunner) {
  const sortedNodes = runner.dag.topologicallySortedNodes();
  // const allEdges = this.dag.getEdges().map(([s, t, e]) => e);
  runner.assignLayers(sortedNodes);
  const taskToDependency = new Map<Task, Task>();
  runner.layers.forEach((nodes, layerNumber) => {
    // console.log(`Layer ${layerNumber}`);
    nodes.forEach((node) => {
      if (layerNumber >= 0) {
        const incomingEdges = runner.dag
          .inEdges(node.config.id)
          .map(([sourceNodeId]: [sourceNodeId: string]) => sourceNodeId);
        // console.log(`  ${node.config.name} <- ${incomingEdges.join(", ")}`);
        for (const sourceNodeId of incomingEdges) {
          if (!taskToDependency.has(node)) {
            const sourceNode = runner.dag.getNode(sourceNodeId);
            if (runner.layers.get(layerNumber - 1)?.find((n) => n == sourceNode)) {
              taskToDependency.set(node, sourceNode!);
            }
          }
        }
      }
    });
  });
  // reverse the map
  const dependencyToTask = new Map<Task, Task[]>();
  taskToDependency.forEach((dependency, task) => {
    if (!dependencyToTask.has(dependency)) {
      dependencyToTask.set(dependency, []);
    }
    dependencyToTask.get(dependency)?.push(task);
  });
  const startNodes = runner.layers.get(0);

  // convert to tree
  const convertToTree = (nodes: TaskStream): TaskTree => {
    const tree: TaskTree = [];
    nodes.forEach((node) => {
      const children = dependencyToTask.get(node);
      if (children) {
        tree.push({ task: node, children: convertToTree(children) });
      } else {
        tree.push({ task: node });
      }
    });
    return tree;
  };
  return convertToTree(startNodes!);
}

const taskTreeToListr = (
  tree: TaskTree = [],
  options: Record<string, any> = { concurrent: false, exitOnError: true }
) => {
  const list: ListrTask[] = [];

  for (const { task, children } of tree) {
    list.push({
      title: task.config.name,
      task: async (_, t) => {
        if (children) {
          return t.newListr(taskTreeToListr(children, options), options);
        } else if (task.status == TaskStatus.COMPLETED || task.status == TaskStatus.FAILED) {
          return;
        }
        return new Observable((observer) => {
          const start = Date.now();
          let lastUpdate = start;
          task.on("progress", (progress: any, file: string) => {
            const timeSinceLast = Date.now() - lastUpdate;
            const timeSinceStart = Date.now() - start;
            if (timeSinceLast > 250 || timeSinceStart > 100) {
              observer.next(createBar(progress / 100 || 0, 30) + " " + (file || ""));
            }
          });
          task.on("complete", () => {
            observer.complete();
          });
          task.on("error", (error) => {
            observer.complete();
          });
        });
      },
    });
  }
  return list;
};

const flattenCompoundGraph = (dag: TaskGraph) => {
  const nodes: Task[] = [];
  const edges: DataFlow[] = [];
  edges.push(...dag.getDataFlows());
  dag.getNodes().forEach((node) => {
    if (node.isCompound) {
      const { nodes: subNodes, edges: subEdges } = flattenCompoundGraph(node.subGraph);
      // const inputNode = new SingleTask({ name: node.config.name, id: node.config.id });
      nodes.push(node);
      nodes.push(...subNodes);
      edges.push(...subEdges);
      const inputs = (node.constructor as any).inputs as TaskInputDefinition[];
      subNodes.forEach((subNode) => {
        inputs.forEach((input) => {
          edges.push(new DataFlow(node.config.id, input.id, subNode.config.id, input.id));
        });
      });
      // const outputs = (node.constructor as any).outputs as TaskOutputDefinition[];
      // const outputNode = new SingleTask();
      // subNodes.forEach((subNode) => {
      //   outputs.forEach((output) => {
      //     edges.push(new DataFlow(subNode.config.id, output.id, node.config.id, output.id));
      //   });
      // });
    } else {
      nodes.push(node);
    }
  });
  return { nodes, edges };
};

const runTaskToListr = async (runner: TaskGraphRunner) => {
  const { nodes, edges } = flattenCompoundGraph(runner.dag);
  const displayGraph = new TaskGraph();
  displayGraph.addTasks(nodes);
  displayGraph.addDataFlows(edges);
  const flatRunner = new TaskGraphRunner(displayGraph);
  const tree = convertToTree(flatRunner);
  const options = {
    exitOnError: true,
    concurrent: true,
    rendererOptions: { timer: PRESET_TIMER },
  };
  const listrTasks = taskTreeToListr(tree, options);
  const listr = new Listr(listrTasks, options);

  listr.run({});
  await sleep(250);
  const result = await runner.runGraph();
  await sleep(250);
  console.log("Result", result);
};

export async function runTask(dag: TaskGraph) {
  const runner = new TaskGraphRunner(dag);
  if (process.stdout.isTTY) {
    await runTaskToListr(runner);
  } else {
    const result = await runner.runGraph();
    console.log(JSON.stringify(result, null, 2));
  }
}

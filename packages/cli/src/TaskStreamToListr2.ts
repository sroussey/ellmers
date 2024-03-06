//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Listr, ListrTask, PRESET_TIMER } from "listr2";
import { Observable } from "rxjs";
import {
  TaskStatus,
  sleep,
  TaskGraph,
  TaskGraphRunner,
  type Task,
  CompoundTask,
} from "ellmers-core";
import { createBar } from "./TaskHelper";

const options = {
  exitOnError: true,
  concurrent: true,
  rendererOptions: { timer: PRESET_TIMER },
};

const runTaskToListr = async (runner: TaskGraphRunner) => {
  const listrTasks = mapTaskGraphToListrTasks(runner);
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

export function mapTaskGraphToListrTasks(runner: TaskGraphRunner): ListrTask[] {
  const graph = runner.dag;
  const sortedNodes = graph.topologicallySortedNodes();
  runner.assignLayers(sortedNodes);
  const children = runner.layers.get(0);
  const listrTasks = children?.map((task) => {
    return mapTaskNodeToListrTask(task, graph) ?? [];
  });
  return listrTasks?.flat() ?? [];
}

function mapCompoundTaskNodeToListrTask(task: CompoundTask, graph: TaskGraph): ListrTask {
  return {
    title: task.config.name,
    task: (ctx, t) => {
      const runner = new TaskGraphRunner(task.subGraph);
      const listTasks = t.newListr(mapTaskGraphToListrTasks(runner), options);
      return listTasks;
    },
  };
}

function mapSimpleTaskNodeToListrTask(task: Task, graph: TaskGraph): ListrTask {
  return {
    title: task.config.name,
    task: async (ctx, t) => {
      if (task.status == TaskStatus.COMPLETED || task.status == TaskStatus.FAILED) return;
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
  };
}

function mapTaskNodeToListrTask(node: Task, graph: TaskGraph): ListrTask {
  const deps = getDependentTasks(node, graph);
  let parent: ListrTask;
  if (node.isCompound) {
    parent = mapCompoundTaskNodeToListrTask(node, graph);
  } else {
    parent = mapSimpleTaskNodeToListrTask(node, graph);
  }
  if (deps.length == 0) {
    return parent;
  } else {
    return {
      title: node.config.name + "Group",
      task: (ctx, t) => {
        const listTasks = t.newListr([parent, ...deps], { ...options, concurrent: false });
        return listTasks;
      },
    };
  }
}

export function getDependentTasks(task: Task, graph: TaskGraph): ListrTask[] {
  return graph
    .getTargetTasks(task.config.id)
    .map((targetTask) => mapTaskNodeToListrTask(targetTask, graph));
}

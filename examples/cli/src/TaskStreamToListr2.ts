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
} from "@ellmers/task-graph";
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
  await sleep(50);
  const result = await runner.runGraph();
  await sleep(50);
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
  const sortedNodes = runner.dag.topologicallySortedNodes();
  runner.assignLayers(sortedNodes);
  const children = runner.layers.get(0);
  const listrTasks = children?.map((task) => {
    return mapTaskNodeToListrTask(task, runner) ?? [];
  });
  return listrTasks?.flat() ?? [];
}

function mapCompoundTaskNodeToListrTask(
  task: CompoundTask,
  parentRunner: TaskGraphRunner
): ListrTask {
  return {
    title: task.config.name,
    task: (ctx, t) => {
      const runner = new TaskGraphRunner(task.subGraph, parentRunner.repository);
      const listTasks = t.newListr(mapTaskGraphToListrTasks(runner), options);
      return listTasks;
    },
  };
}

function mapSimpleTaskNodeToListrTask(task: Task): ListrTask {
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
        task.on("error", () => {
          observer.complete();
        });
      });
    },
  };
}

function mapTaskNodeToListrTask(node: Task, runner: TaskGraphRunner): ListrTask {
  const deps = getDependentTasks(node, runner);
  let parent: ListrTask;
  if (node.isCompound) {
    parent = mapCompoundTaskNodeToListrTask(node, runner);
  } else {
    parent = mapSimpleTaskNodeToListrTask(node);
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

export function getDependentTasks(task: Task, runner: TaskGraphRunner): ListrTask[] {
  const graph: TaskGraph = runner.dag;
  return graph
    .getTargetTasks(task.config.id)
    .map((targetTask) => mapTaskNodeToListrTask(targetTask, runner));
}

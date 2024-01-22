//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import {
  TaskStreamable,
  type TaskStream,
  TaskStatus,
  TaskListOrdering,
} from "#/Task";
import { Listr, ListrTask } from "listr2";
import { createBar } from "./TaskHelper";
import { PRESET_TIMER } from "listr2";
import { Observable } from "rxjs";

const taskArrayToListr = (
  tasks: TaskStream,
  options: Record<string, any> = { concurrent: false, exitOnError: true }
): Listr => {
  const list: ListrTask[] = [];

  for (const task of tasks) {
    switch (task.kind) {
      case "TASK":
        list.push({
          title: task.config.name,
          task: async (_, t) => {
            if (
              task.status == TaskStatus.COMPLETED ||
              task.status == TaskStatus.FAILED
            ) {
              return;
            }
            return new Observable((observer) => {
              const start = Date.now();
              let lastUpdate = start;
              task.on("progress", (progress, file) => {
                const timeSinceLast = Date.now() - lastUpdate;
                const timeSinceStart = Date.now() - start;
                if (timeSinceLast > 250 || timeSinceStart > 100) {
                  observer.next(
                    createBar(progress / 100 || 0, 30) + " " + (file || "")
                  );
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
        });
        break;
      case "TASK_LIST":
        list.push({
          title: task.config.name,
          task: async (_, t) => {
            return taskArrayToListr(task.tasks, {
              concurrent: task.ordering == TaskListOrdering.PARALLEL,
              exitOnError: task.ordering == TaskListOrdering.SERIAL,
            });
          },
        });
        break;
      case "STRATEGY":
        list.push({
          title: task.config.name,
          task: async (_, t) => {
            return taskArrayToListr(task.tasks);
          },
        });
        break;
    }
  }
  const listr = new Listr(list, options);
  return listr;
};

export const runTaskToListr = async (task: TaskStreamable) => {
  const listrTasks = taskArrayToListr([task], {
    exitOnError: true,
    concurrent: false,
    rendererOptions: { timer: PRESET_TIMER },
  });
  listrTasks.run({});
  await new Promise((resolve) => setTimeout(resolve, 100));
  await task.run({});
};

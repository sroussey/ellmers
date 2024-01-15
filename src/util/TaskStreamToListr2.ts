//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { TaskStreamable, type TaskStream, Task, TaskStatus } from "#/Task";
import { Listr, ListrTask } from "listr2";
import { createBar } from "../../src-examples/TaskHelper";
import { PRESET_TIMER } from "listr2";
import { Observable } from "rxjs";

const taskArrayToListr = (
  tasks: TaskStream,
  options: Record<string, any> = { concurrent: false }
): Listr => {
  const list: ListrTask[] = [];

  for (const task of tasks) {
    switch (task.kind) {
      case "TASK":
        list.push({
          title: task.name,
          task: async (_, t) => {
            if (task.status == TaskStatus.COMPLETED) {
              return;
            }
            return new Observable((observer) => {
              const start = Date.now();
              let lastUpdate = start;
              task.on("progress", (progress) => {
                const timeSinceLast = Date.now() - lastUpdate;
                const timeSinceStart = Date.now() - start;
                if (timeSinceLast > 250 || timeSinceStart > 100) {
                  observer.next(createBar(progress / 100 || 0, 30));
                }
              });
              task.on("complete", () => {
                observer.complete();
              });
            });
          },
        });
        break;
      case "TASK_LIST":
        list.push({
          title: task.name,
          task: async (_, t) => {
            return taskArrayToListr(task.tasks, {
              concurrent: task.ordering == "parallel",
              exitOnError: task.ordering == "serial",
            });
          },
        });
        break;
      case "STRATEGY":
        list.push({
          title: task.name,
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
  listrTasks.run();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await task.run();
};

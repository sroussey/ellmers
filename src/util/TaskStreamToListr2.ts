//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { TaskStreamable, type TaskStream } from "#/Task";
import { Listr, ListrTask } from "listr2";
import { TaskHelper } from "../../src-examples/TaskHelper";
import { PRESET_TIMER } from "listr2";

// ===============================================================================
//   NOTE     this will not call run() on anything but a basic task         NOTE
//
//   This is temporary until I can create a proper Listr task set for our real
//   tasks which only observes them. At that point, it will run the top level
//   task only.
//
//   TODO!
//
// ===============================================================================

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
            const helper = new TaskHelper(t, 100);
            task.on("progress", (progress) => {
              helper.updateProgress(progress / 100 || 0);
            });
            await task.run();
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

export const taskToListr = (tasks: TaskStreamable): Listr => {
  return taskArrayToListr([tasks], {
    exitOnError: true,
    concurrent: false,
    rendererOptions: { timer: PRESET_TIMER },
  });
};

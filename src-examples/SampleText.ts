//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command } from "commander";

import { featureExtractionModelList } from "#/storage/InMemoryStorage";
import { taskToListr } from "#/util/TaskStreamToListr2";
import { DownloadTask } from "#/tasks/LocalHuggingFaceTasks";
import {
  LambdaTask,
  ParallelTaskList,
  SerialTaskList,
  Strategy,
  Task,
} from "#/Task";

export function AddSampleCommand(program: Command) {
  program
    .command("download")
    .description("download models")
    .action(async (options) => {
      const task = new Strategy({
        name: "Run some stuff",
        tasks: [
          new LambdaTask({ name: "Do something first", run: async () => {} }),
          new ParallelTaskList({
            name: "Download Models",
            tasks: featureExtractionModelList.map(
              (model) => new DownloadTask({ model })
            ),
          }),
          new LambdaTask({ name: "Do something else", run: async () => {} }),
        ],
      });
      const listrTasks = taskToListr(task);

      await listrTasks.run({});
    });
}

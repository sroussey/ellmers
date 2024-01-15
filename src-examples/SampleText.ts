//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command } from "commander";

import { allModels } from "#/storage/InMemoryStorage";
import { runTaskToListr } from "#/util/TaskStreamToListr2";
import { DownloadTask } from "#/tasks/HuggingFaceLocalTasks";
import { LambdaTask, ParallelTaskList, Strategy } from "#/Task";
import { Model, ONNXTransformerJsModel } from "#/Model";
import { EmbeddingTask, SummarizationTask } from "#/tasks/FactoryTasks";

export function AddSampleCommand(program: Command) {
  program
    .command("download")
    .description("download models")
    .option("--model <name>", "model to download")
    .option(
      "--pipeline <name>",
      "model group to download based on pipeline type"
    )
    .action(async (options) => {
      let models: ONNXTransformerJsModel[] = [];
      if (options.model) {
        const model = allModels.find((m) => m.name == options.model);
        if (model) {
          models.push(model);
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      }
      if (options.pipeline) {
        const found = allModels.filter((m) => m.pipeline == options.pipeline);
        if (found.length) {
          models.push(...found);
        } else {
          program.error(`Unknown pipeline ${options.pipeline}`);
        }
      }
      if (!models.length) {
        models = allModels;
      }
      const task = new Strategy({
        name: "Download Command",
        tasks: [
          new LambdaTask({
            name: "Do something first",
            run: async () => {},
          }),
          new ParallelTaskList({
            name: "Download Models",
            tasks: models.map((model) => new DownloadTask({ model })),
          }),
          new LambdaTask({
            name: "Do something else",
            run: async () => {},
          }),
        ],
      });

      await runTaskToListr(task);

      await Bun.sleep(100);
    });

  program
    .command("embedding")
    .description("get a embedding vector for a piece of text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use", "Xenova/bge-small-en-v1.5")
    .action(async (text, options) => {
      let model = allModels.find((m) => m.name == options.model);
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      }

      const task = new EmbeddingTask({ model, text });

      await runTaskToListr(task);

      await Bun.sleep(100);
      console.log(task.output);
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use", "Xenova/distilbart-cnn-6-6")
    .action(async (text, options) => {
      let model = allModels.find((m) => m.name == options.model);
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      }

      const task = new SummarizationTask({ model, text });

      await runTaskToListr(task);

      await Bun.sleep(100);
      console.log(task.output);
    });
}

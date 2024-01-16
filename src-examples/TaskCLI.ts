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
import {
  EmbeddingTask,
  RewriterTask,
  SummarizeTask,
} from "#/tasks/FactoryTasks";
import {
  EmbeddingStrategy,
  RewriterStrategy,
  SummarizeStrategy,
} from "#/tasks/Strategies";

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
      let models = allModels.slice();
      if (options.model) {
        const model = allModels.find((m) => m.name == options.model);
        if (model) {
          models = [model];
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

      await new Promise((resolve) => setTimeout(resolve, 100));
    });

  program
    .command("embedding")
    .description("get a embedding vector for a piece of text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      let task;
      if (options.model) {
        const model = allModels.find((m) => m.name == options.model);
        if (model) {
          task = new EmbeddingTask({ model, text });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = allModels.filter(
          (m) => m.pipeline == "feature-extraction"
        );
        task = new EmbeddingStrategy({ text, models });
      }

      await runTaskToListr(task);

      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(task.output[0]);
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      let task;
      if (options.model) {
        const model = allModels.find((m) => m.name == options.model);
        if (model) {
          task = new SummarizeTask({ model, text });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = allModels.filter((m) => m.pipeline == "summarization");
        task = new SummarizeStrategy({ text, models });
      }

      await runTaskToListr(task);

      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(task.output[0]);
    });

  program
    .command("rewrite")
    .description("rewrite text")
    .argument("<text>", "text to rewrite")
    .option("--instruction <instruction>", "instruction for how to rewrite", "")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      let task;
      if (options.model) {
        const model = allModels.find((m) => m.name == options.model);
        if (model) {
          task = new RewriterTask({ model, text, prompt: options.instruction });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = allModels.filter(
          (m) =>
            m.pipeline === "text-generation" ||
            m.pipeline === "text2text-generation"
        );
        task = new RewriterStrategy({
          text,
          prompt: options.instruction,
          model: models,
        });
      }

      await runTaskToListr(task);

      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(task.output[0]);
    });
}

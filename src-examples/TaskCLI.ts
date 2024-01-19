//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command } from "commander";
import { allModels } from "#/storage/InMemoryStorage";
import { runTaskToListr } from "#/util/TaskStreamToListr2";
import { DownloadTask } from "#/tasks/HuggingFaceLocalTasks";
import { ParallelTaskList } from "#/Task";
import {
  EmbeddingTask,
  RewriterTask,
  SummarizeTask,
} from "#/tasks/FactoryTasks";
import {
  EmbeddingStrategy,
  RewriterEmbeddingStrategy,
  RewriterStrategy,
  SummarizeStrategy,
} from "#/tasks/Strategies";
import { sleep } from "#/util/Misc";

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
      const task = new ParallelTaskList(
        { name: "Download Models" },
        models.map(
          (model) => new DownloadTask({ name: "Downloading models" }, { model })
        )
      );
      await runTaskToListr(task);

      await sleep(100);
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
          task = new EmbeddingTask({ name: "Embed one" }, { model, text });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = allModels.filter(
          (m) => m.pipeline == "feature-extraction"
        );
        task = new EmbeddingStrategy(
          { name: "Embed several" },
          { text, models }
        );
      }

      await runTaskToListr(task);

      await sleep(100);
      console.log(task.output);
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
          task = new SummarizeTask({ name: "Summarize" }, { model, text });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = allModels.filter((m) => m.pipeline == "summarization");
        task = new SummarizeStrategy({ name: "Summarize" }, { text, models });
      }

      await runTaskToListr(task);

      await sleep(100);
      console.log(task.output);
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
          task = new RewriterTask(
            { name: "Rewrite" },
            { model, text, prompt: options.instruction }
          );
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = allModels.filter(
          (m) =>
            m.pipeline === "text-generation" ||
            m.pipeline === "text2text-generation"
        );
        task = new RewriterStrategy(
          { name: "Rewrite" },
          {
            text,
            prompt: options.instruction,
            model: models,
          }
        );
      }

      await runTaskToListr(task);

      await sleep(100);
      console.log("rewrite output", task.output);
    });

  program
    .command("test")
    .description("test")
    .argument("<text>", "text to rewrite")
    .action(async (text) => {
      const prompt = [
        "Rewrite the following text:",
        "Rewrite the following and make it more descriptive:",
      ];
      const prompt_model = allModels.filter(
        (m) =>
          m.pipeline === "text-generation" ||
          m.pipeline === "text2text-generation"
      );

      const embed_model = allModels.filter(
        (m) => m.pipeline === "feature-extraction"
      );

      const task = new RewriterEmbeddingStrategy(
        { name: "Test" },
        {
          text,
          prompt,
          prompt_model,
          embed_model,
        }
      );

      await runTaskToListr(task);

      await sleep(100);
      console.log(task.output);
    });
}

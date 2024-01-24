//    ****************************************************************************
//    *   ELMERS: Embedding Large Language Model Experiential Retrieval Service  *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { Command } from "commander";
import { runTaskToListr } from "./TaskStreamToListr2";
import { ParallelTaskList } from "#/Task";
import {
  EmbeddingTask,
  RewriterTask,
  SummarizeTask,
  DownloadTask,
} from "#/tasks/FactoryTasks";
import {
  EmbeddingStrategy,
  RewriterEmbeddingStrategy,
  RewriterStrategy,
  SummarizeStrategy,
} from "#/tasks/Strategies";
import { sleep } from "#/util/Misc";
import { JsonStrategy, TaskJsonInput } from "#/tasks/JsonTask";
import { ModelUseCaseEnum } from "#/Model";
import {
  findAllModels,
  findModelByName,
  findModelByUseCase,
} from "#/storage/InMemoryStorage";

async function runTask(task: any) {
  if (process.stdout.isTTY) {
    await runTaskToListr(task);
    await sleep(100);
    console.log(task.output);
  } else {
    await task.run({});
    process.stdout.write(JSON.stringify(task.output));
  }
}

export function AddSampleCommand(program: Command) {
  program
    .command("download")
    .description("download models")
    .option("--model <name>", "model to download")
    .action(async (options) => {
      let models = findAllModels();
      if (options.model) {
        const model = findModelByName(options.model);
        if (model) {
          models = [model];
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      }

      const task = new ParallelTaskList(
        { name: "Download Models" },
        models.map((model) => new DownloadTask({}, { model }))
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
        const model = findModelByName(options.model);
        if (model) {
          task = new EmbeddingTask({}, { model, text });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = findModelByUseCase(ModelUseCaseEnum.TEXT_EMBEDDING);
        task = new EmbeddingStrategy(
          { name: "Embed several" },
          { text, models }
        );
      }

      await runTask(task);
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      let task;
      if (options.model) {
        const model = findModelByName(options.model);
        if (model) {
          task = new SummarizeTask({}, { model, text });
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = findModelByUseCase(ModelUseCaseEnum.TEXT_SUMMARIZATION);
        task = new SummarizeStrategy({}, { text, models });
      }

      await runTask(task);
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
        const model = findModelByName(options.model);
        if (model) {
          task = new RewriterTask(
            { name: "Rewrite" },
            { model, text, prompt: options.instruction }
          );
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = findModelByUseCase(ModelUseCaseEnum.TEXT_GENERATION);
        task = new RewriterStrategy(
          { name: "Rewrite" },
          {
            text,
            prompt: options.instruction,
            model: models,
          }
        );
      }

      await runTask(task);
    });

  program
    .command("rewrite-embedding")
    .description("rewrite based on internal prompt list, then embed")
    .argument("<text>", "text to rewrite and vectorize")
    .action(async (text) => {
      const prompt = [
        "Rewrite the following text:",
        "Rewrite the following and make it more descriptive:",
      ];
      const prompt_model = findModelByUseCase(ModelUseCaseEnum.TEXT_GENERATION);

      const embed_model = findModelByUseCase(ModelUseCaseEnum.TEXT_EMBEDDING);

      const task = new RewriterEmbeddingStrategy(
        {},
        {
          text,
          prompt,
          prompt_model,
          embed_model,
        }
      );

      await runTask(task);
    });

  program
    .command("json")
    .description("run based on json input")
    .argument("[json]", "json text to rewrite and vectorize")
    .action(async (jsonText) => {
      if (!jsonText) {
        const exampleJson: TaskJsonInput[] = [
          {
            run: "RewriterTask",
            config: {
              output_name: "results",
            },
            input: {
              text: "The quick brown fox jumps over the lazy dog.",
              prompt: "Rewrite the following text in reverse:",
              model: "Xenova/LaMini-Flan-T5-783M",
            },
          },
          {
            run: "RenameTask",
            input: {
              output_remap_array: [{ from: "results", to: "reverse" }],
            },
          },
        ];
        jsonText = JSON.stringify(exampleJson);
      }
      const json = JSON.parse(jsonText);
      const task = new JsonStrategy({ name: "Test JSON" }, json);

      await runTask(task);
    });

  program.command("test").action(async () => {
    //
  });
}

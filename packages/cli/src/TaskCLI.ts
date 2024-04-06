//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Command } from "commander";
import { runTask } from "./TaskStreamToListr2";
import "@sroussey/transformers";
import {
  findAllModels,
  findModelByName,
  findModelByUseCase,
  DownloadModelTask,
  ModelUseCaseEnum,
  TaskGraph,
  JsonTask,
  TaskGraphBuilder,
  DownloadModelCompoundTask,
  JsonTaskItem,
} from "ellmers-core/server";

export function AddBaseCommands(program: Command) {
  program
    .command("download")
    .description("download models")
    .option("--model <name>", "model to download")
    .action(async (options) => {
      const models = findAllModels();
      const graph = new TaskGraph();
      if (options.model) {
        const model = findModelByName(options.model);
        if (model) {
          graph.addTask(new DownloadModelTask({ input: { model: model.name } }));
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        graph.addTask(
          new DownloadModelCompoundTask({
            input: { model: models.map((m) => m.name) },
          })
        );
      }
      await runTask(graph);
    });

  program
    .command("embedding")
    .description("get a embedding vector for a piece of text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text: string, options) => {
      const model = options.model
        ? findModelByName(options.model)?.name
        : findModelByUseCase(ModelUseCaseEnum.TEXT_EMBEDDING).map((m) => m.name);
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      } else {
        const build = new TaskGraphBuilder();
        build.TextEmbedding({ model, text });
        await runTask(build._graph);
      }
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      const model = options.model
        ? findModelByName(options.model)?.name
        : findModelByUseCase(ModelUseCaseEnum.TEXT_SUMMARIZATION).map((m) => m.name);
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      } else {
        const build = new TaskGraphBuilder();
        build.TextSummary({ model, text });
        await runTask(build._graph);
      }
    });

  program
    .command("rewrite")
    .description("rewrite text")
    .argument("<text>", "text to rewrite")
    .option("--prompt <prompt>", "instruction for how to rewrite", "")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      const model = options.model
        ? findModelByName(options.model)?.name
        : findModelByUseCase(ModelUseCaseEnum.TEXT_REWRITING).map((m) => m.name);
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      } else {
        const build = new TaskGraphBuilder();
        build.TextRewriter({ model, text, prompt: options.prompt });
        await runTask(build._graph);
      }
    });

  program
    .command("json")
    .description("run based on json input")
    .argument("[json]", "json text to rewrite and vectorize")
    .action(async (json) => {
      if (!json) {
        const exampleJson: JsonTaskItem[] = [
          {
            id: "1",
            type: "DownloadModelTask",
            input: {
              model: "Xenova/LaMini-Flan-T5-783M",
            },
          },
          {
            id: "2",
            type: "TextRewriterTask",
            input: {
              text: "The quick brown fox jumps over the lazy dog.",
              prompt: "Rewrite the following text in reverse:",
            },
            dependencies: {
              model: {
                id: "1",
                output: "model",
              },
            },
          },
        ];
        json = JSON.stringify(exampleJson);
      }
      const task = new JsonTask({ name: "Test JSON", input: { json } });
      const graph = new TaskGraph();
      graph.addTask(task);
      await runTask(graph);
    });

  program
    .command("builder")
    .description("run based on builder")
    .action(async () => {
      const builder = new TaskGraphBuilder();
      builder
        .DownloadModel({ model: "Supabase/gte-small" })
        .TextEmbedding({
          text: "The quick brown fox jumps over the lazy dog.",
        })
        .rename("vector", "message")
        .DebugLog();

      try {
        await builder.run();
      } catch {}
    });
}

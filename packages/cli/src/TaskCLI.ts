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
  EmbeddingTask,
  TextRewriterTask,
  TextSummaryTask,
  TextSummaryMultiModelTask,
  DownloadTask,
  ModelUseCaseEnum,
  EmbeddingMultiModelTask,
  registerHuggingfaceLocalTasks,
  registerMediaPipeTfJsLocalTasks,
  DownloadMultiModelTask,
  TextRewriterMultiModelTask,
  TaskGraph,
  JsonTaskArray,
  JsonTask,
} from "ellmers-core/server";

registerHuggingfaceLocalTasks();
registerMediaPipeTfJsLocalTasks();

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
          graph.addTask(new DownloadTask({ input: { model: model.name } }));
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        graph.addTask(
          new DownloadMultiModelTask({
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
      const graph = new TaskGraph();
      if (options.model) {
        const model = findModelByName(options.model);
        if (model) {
          graph.addTask(new EmbeddingTask({ input: { model: model.name, text } }));
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = findModelByUseCase(ModelUseCaseEnum.TEXT_EMBEDDING);
        graph.addTask(
          new EmbeddingMultiModelTask({
            name: "Embed several",
            input: { text, model: models.map((m) => m.name) },
          })
        );
      }
      await runTask(graph);
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      const graph = new TaskGraph();
      if (options.model) {
        const model = findModelByName(options.model);
        if (model) {
          graph.addTask(new TextSummaryTask({ input: { model: model.name, text } }));
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = findModelByUseCase(ModelUseCaseEnum.TEXT_SUMMARIZATION);
        graph.addTask(
          new TextSummaryMultiModelTask({
            input: { text, model: models.map((m) => m.name) },
          })
        );
      }
      await runTask(graph);
    });

  program
    .command("rewrite")
    .description("rewrite text")
    .argument("<text>", "text to rewrite")
    .option("--instruction <instruction>", "instruction for how to rewrite", "")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      const graph = new TaskGraph();
      if (options.model) {
        const model = findModelByName(options.model);
        if (model) {
          graph.addTask(
            new TextRewriterTask({
              input: { model: model.name, text, prompt: options.instruction },
            })
          );
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      } else {
        let models = findModelByUseCase(ModelUseCaseEnum.TEXT_GENERATION);
        graph.addTask(
          new TextRewriterMultiModelTask({
            input: {
              text,
              prompt: options.instruction,
              model: models.map((m) => m.name),
            },
          })
        );
      }

      await runTask(graph);
    });

  program
    .command("json")
    .description("run based on json input")
    .argument("[json]", "json text to rewrite and vectorize")
    .action(async (json) => {
      if (!json) {
        const exampleJson: JsonTaskArray = [
          {
            id: "1",
            type: "DownloadTask",
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
}

//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

/*

TODO: Maybe have strategies generate a list of tasks for a task run for save/restore
not sure, just thinking out loud. I am wondering how to propagate user_id etc
later on. And thinking about how to save the task tree to disc to restore later.

*/
import { Model } from "#/Model";
import {
  IStrategy,
  ParallelTaskList,
  SerialTaskList,
  Strategy,
  TaskStream,
} from "#/Task";
import { forceArray } from "#/util/Misc";
import { EmbeddingTask, RewriterTask, SummarizeTask } from "./FactoryTasks";

interface EmbeddingStrategyInput {
  text: string;
  models: Model[];
}
export class EmbeddingStrategy extends Strategy {
  declare input: EmbeddingStrategyInput;
  constructor(config: Partial<IStrategy>, input: EmbeddingStrategyInput) {
    const name = config.name || `Vary Embedding content`;
    super(config, [
      new ParallelTaskList(
        { name: name + " In Parallel" },
        input.models.map(
          (model) => new EmbeddingTask({}, { text: input.text, model })
        )
      ),
    ]);
  }
}

interface SummarizeStrategyInput {
  text: string;
  models: Model[];
}
export class SummarizeStrategy extends Strategy {
  declare input: SummarizeStrategyInput;
  constructor(config: Partial<IStrategy>, input: SummarizeStrategyInput) {
    const name = config.name || `Vary Summarize content`;
    super({ name: name + " In Parallel" }, [
      new ParallelTaskList(
        { name },
        input.models.map(
          (model) => new SummarizeTask({}, { text: input.text, model })
        )
      ),
    ]);
  }
}

interface RewriterStrategyInput {
  text: string;
  prompt?: string | string[];
  model?: Model | Model[];
  prompt_model_pair?: { prompt: string; model: Model }[];
}
export class RewriterStrategy extends Strategy {
  declare input: RewriterStrategyInput;
  constructor(config: Partial<IStrategy>, input: RewriterStrategyInput) {
    const name = config.name || `Vary Rewriter content`;
    const text = input.text;
    let pairs: { prompt: string; model: Model }[] = [];
    if (input.prompt_model_pair) {
      pairs = forceArray(input.prompt_model_pair);
    } else {
      if (!input.prompt || !input.model) throw new Error("Invalid input");
      const models = forceArray(input.model);
      const prompts = forceArray(input.prompt);
      for (const model of models) {
        for (const prompt of prompts) {
          pairs.push({ prompt, model });
        }
      }
    }

    super({ name: name + " In Parallel" }, [
      new ParallelTaskList(
        { name: name },
        pairs.map(
          ({ prompt, model }) => new RewriterTask({}, { text, prompt, model })
        )
      ),
    ]);
  }
}

interface RewriterEmbeddingStrategyInput {
  text: string;
  prompt?: string | string[];
  prompt_model?: Model | Model[];
  embed_model?: Model | Model[];
  prompt_model_tuple?: {
    prompt: string;
    prompt_model: Model;
    embed_model: Model;
  }[];
}

export class RewriterEmbeddingStrategy extends Strategy {
  declare input: RewriterEmbeddingStrategyInput;
  constructor(
    config: Partial<IStrategy>,
    input: RewriterEmbeddingStrategyInput
  ) {
    const name = config.name || `RewriterEmbeddingStrategy`;
    const text = input.text;
    let tasks: TaskStream = [];
    if (input.prompt_model_tuple) {
      const tuples = forceArray(input.prompt_model_tuple);
      tasks = [
        new Strategy(
          { name: name + " In Parallel" },
          tuples.map(({ prompt, prompt_model, embed_model }) => {
            return new SerialTaskList({ name }, [
              new RewriterTask(
                { name: name + " Rewriter" },
                { text, prompt, model: prompt_model }
              ),
              new EmbeddingTask(
                { name: name + " Embedding" },
                { text, model: embed_model }
              ),
            ]);
          })
        ),
      ];
    } else {
      if (!input.prompt || !input.prompt_model || !input.embed_model)
        throw new Error("Invalid input");
      const prompt_model = forceArray(input.prompt_model);
      const embed_model = forceArray(input.embed_model);
      const prompts = forceArray(input.prompt);
      for (const prompt of prompts) {
        tasks.push(
          new Strategy({ name }, [
            new RewriterStrategy(
              { name: name + " Rewriter" },
              { text, prompt, model: prompt_model }
            ),
            new EmbeddingStrategy(
              { name: name + " Embedding" },
              { text, models: embed_model }
            ),
          ])
        );
      }
    }

    super(config, tasks, input);
  }
}

//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model } from "#/Model";
import { ParallelTaskList, Strategy } from "#/Task";
import { EmbeddingTask, RewriterTask, SummarizeTask } from "./FactoryTasks";

export class EmbeddingStrategy extends Strategy {
  constructor(input: { text: string; models: Model[]; name?: string }) {
    const name = input.name || `Vary Embedding content`;
    super({
      name: name + " In Parallel",
      tasks: [
        new ParallelTaskList({
          name: name,
          tasks: input.models.map(
            (model) => new EmbeddingTask({ text: input.text, model })
          ),
        }),
      ],
    });
  }
}

export class SummarizeStrategy extends Strategy {
  constructor(input: { text: string; models: Model[]; name?: string }) {
    const name = input.name || `Vary Summarize content`;
    super({
      name: name + " In Parallel",
      tasks: [
        new ParallelTaskList({
          name: name,
          tasks: input.models.map(
            (model) => new SummarizeTask({ text: input.text, model })
          ),
        }),
      ],
    });
  }
}

interface RewriterStrategyInput {
  text: string;
  name?: string;
  prompt?: string | string[];
  model?: Model | Model[];
  prompt_model?: { prompt: string; model: Model }[];
}

export class RewriterStrategy extends Strategy {
  constructor(input: RewriterStrategyInput) {
    const { name = input.name || `Vary Rewriter content`, text } = input;
    const pairs = [];

    if (input.prompt_model) {
      if (Array.isArray(input.prompt_model)) {
        pairs.push(...input.prompt_model);
      } else {
        pairs.push(input.prompt_model);
      }
    } else {
      if (!input.prompt || !input.model) throw new Error("Invalid input");
      const models = Array.isArray(input.model) ? input.model : [input.model];
      const prompts = Array.isArray(input.prompt)
        ? input.prompt
        : [input.prompt];
      for (const model of models) {
        for (const prompt of prompts) {
          pairs.push({ prompt, model });
        }
      }
    }

    super({
      name: name + " In Parallel",
      tasks: [
        new ParallelTaskList({
          name: name,
          tasks: pairs.map(
            ({ prompt, model }) => new RewriterTask({ text, prompt, model })
          ),
        }),
      ],
    });
  }
}

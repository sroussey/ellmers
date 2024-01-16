//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model } from "#/Model";
import { ParallelTaskList, Strategy } from "#/Task";
import {
  EmbeddingTask,
  RewriterTask,
  SummarizeTask,
  TextGenerationTask,
} from "./FactoryTasks";

export class EmbeddingMultiModelStrategy extends Strategy {
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

export class SummarizeMultiModelStrategy extends Strategy {
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

export class RewriterMultiModelStrategy extends Strategy {
  constructor(input: {
    text: string;
    prompt: string;
    models: Model[];
    name?: string;
  }) {
    const {
      name = input.name || `Vary Rewriter content`,
      prompt,
      text,
    } = input;
    super({
      name: name + " In Parallel",
      tasks: [
        new ParallelTaskList({
          name: name,
          tasks: input.models.map(
            (model) => new RewriterTask({ text, prompt, model })
          ),
        }),
      ],
    });
  }
}

//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model, ONNXTransformerJsModel } from "#/Model";
import { ParallelTaskList, Strategy } from "#/Task";
import { EmbeddingTask, TextGenerationTask } from "./FactoryTasks";

export class VaryEmbeddingStrategy extends Strategy {
  constructor(input: { text: string; models: Model[]; name?: string }) {
    const name = input.name || `Vary Embedding content`;
    super({
      name: name + " In Parralel",
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

export class VaryRewriterStrategy extends Strategy {
  constructor(options: {
    text: string;
    models: ONNXTransformerJsModel[];
    name?: string;
  }) {
    const name = options.name || `Vary Rewriter content`;
    super({
      name: name + " In Parralel",
      tasks: [
        new ParallelTaskList({
          name: name,
          tasks: options.models.map(
            (model) => new TextGenerationTask({ text: options.text, model })
          ),
        }),
      ],
    });
  }
}

//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model, ONNXTransformerJsModel } from "#/Model";
import { Task } from "#/Task";
import {
  HuggingFaceLocal_EmbeddingTask,
  HuggingFaceLocal_QuestionAnswerTask,
  HuggingFaceLocal_SummarizationTask,
  HuggingFaceLocal_TextGenerationTask,
} from "./HuggingFaceLocalTasks";

class FactoryTask extends Task {
  async run() {
    this.emit("start");
    this.error = "FactoryTask cannot be run";
    this.emit("error", this.error);
  }
}

/**
 * This is a task that generates an embedding for a single piece of text
 */
export class EmbeddingTask extends FactoryTask {
  constructor(input: { text: string; model: Model; name?: string }) {
    const { text, model, name } = input;
    super({ name: `Embedding ${model.name}` });
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_EmbeddingTask({ text, model, name });
    }
  }
}

export class TextGenerationTask extends FactoryTask {
  constructor(input: { text: string; model: Model; name?: string }) {
    const { text, model, name } = input;
    super({ name: "Text Generation" });
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_TextGenerationTask({ text, model, name });
    }
  }
}

export class SummarizationTask extends FactoryTask {
  constructor(input: { text: string; model: Model; name?: string }) {
    const { text, model, name } = input;
    super({ name: "Summarization" });
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_SummarizationTask({ text, model, name });
    }
  }
}

export class QuestionAnswerTask extends FactoryTask {
  constructor(input: {
    text: string;
    context: string;
    model: Model;
    name?: string;
  }) {
    const { text, context, model, name } = input;
    super({ name: "Summarization" });
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_QuestionAnswerTask({
        text,
        context,
        model,
        name,
      });
    }
  }
}

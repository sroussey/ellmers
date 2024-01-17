//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model } from "#/Model";
import { ITask, Task } from "#/Task";
import {
  ONNXTransformerJsModel,
  HuggingFaceLocal_EmbeddingTask,
  HuggingFaceLocal_QuestionAnswerTask,
  HuggingFaceLocal_SummarizationTask,
  HuggingFaceLocal_TextGenerationTask,
  HuggingFaceLocal_TextRewriterTask,
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
  constructor(config: Partial<ITask>, input: { text: string; model: Model }) {
    const { text, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_EmbeddingTask(config, { text, model });
    }
  }
}

export class TextGenerationTask extends FactoryTask {
  constructor(config: Partial<ITask>, input: { text: string; model: Model }) {
    const { text, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_TextGenerationTask(config, { text, model });
    }
  }
}

export class SummarizeTask extends FactoryTask {
  constructor(config: Partial<ITask>, input: { text: string; model: Model }) {
    const { text, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_SummarizationTask(config, { text, model });
    }
  }
}

export class RewriterTask extends FactoryTask {
  constructor(
    config: Partial<ITask>,
    input: {
      text: string;
      prompt: string;
      model: Model;
    }
  ) {
    const { text, prompt, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_TextRewriterTask(config, {
        text,
        prompt,
        model,
      });
    }
  }
}

export class QuestionAnswerTask extends FactoryTask {
  constructor(
    config: Partial<ITask>,
    input: {
      text: string;
      context: string;
      model: Model;
    }
  ) {
    const { text, context, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_QuestionAnswerTask(config, {
        text,
        context,
        model,
      });
    }
  }
}

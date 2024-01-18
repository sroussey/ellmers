//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model } from "#/Model";
import { TaskConfig, Task, TaskInput } from "#/Task";
import {
  ONNXTransformerJsModel,
  HuggingFaceLocal_EmbeddingTask,
  HuggingFaceLocal_QuestionAnswerTask,
  HuggingFaceLocal_SummarizationTask,
  HuggingFaceLocal_TextGenerationTask,
  HuggingFaceLocal_TextRewriterTask,
} from "./HuggingFaceLocalTasks";

class FactoryTask extends Task {
  async run(input?: TaskInput) {
    this.emit("start");
    this.error = "FactoryTask cannot be run";
    this.emit("error", this.error);
    return this.output;
  }
}

interface EmbeddingTaskInput {
  text: string;
  model: Model;
}
/**
 * This is a task that generates an embedding for a single piece of text
 */
export class EmbeddingTask extends FactoryTask {
  declare input: EmbeddingTaskInput;
  constructor(config: TaskConfig, input: EmbeddingTaskInput) {
    const { text, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_EmbeddingTask(config, { text, model });
    }
  }
}

interface TextGenerationTaskInput {
  text: string;
  model: Model;
}
export class TextGenerationTask extends FactoryTask {
  declare input: TextGenerationTaskInput;
  constructor(config: TaskConfig, input: TextGenerationTaskInput) {
    const { text, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_TextGenerationTask(config, { text, model });
    }
  }
}

export class SummarizeTask extends FactoryTask {
  declare input: TextGenerationTaskInput;
  constructor(config: TaskConfig, input: TextGenerationTaskInput) {
    const { text, model } = input;
    super(config, input);
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_SummarizationTask(config, { text, model });
    }
  }
}

interface RewriterTaskInput {
  text: string;
  prompt: string;
  model: Model;
}

export class RewriterTask extends FactoryTask {
  declare input: RewriterTaskInput;
  constructor(config: TaskConfig, input: RewriterTaskInput) {
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

interface QuestionAnswerTaskInput {
  text: string;
  context: string;
  model: Model;
}
export class QuestionAnswerTask extends FactoryTask {
  declare input: QuestionAnswerTaskInput;
  constructor(config: TaskConfig, input: QuestionAnswerTaskInput) {
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

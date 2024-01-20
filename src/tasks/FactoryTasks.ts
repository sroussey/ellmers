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

export interface ModelFactoryTaskInput {
  model: Model;
}

abstract class ModelFactoryTask extends Task {
  declare input: ModelFactoryTaskInput;
  constructor(config: TaskConfig = {}, defaults: ModelFactoryTaskInput) {
    super(config, defaults);
  }

  run(overrides?: TaskInput): Promise<TaskInput> {
    throw new Error("ModelFactoryTask:run() ethod not implemented.");
  }
}

export interface EmbeddingTaskInput {
  text: string;
  model: Model;
}
/**
 * This is a task that generates an embedding for a single piece of text
 */
export class EmbeddingTask extends ModelFactoryTask {
  declare input: EmbeddingTaskInput;
  constructor(config: TaskConfig = {}, defaults: EmbeddingTaskInput) {
    super(config, defaults);
    const { text, model } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_EmbeddingTask(this.config, { text, model });
    }
  }
}
Task.all.set("EmbeddingTask", EmbeddingTask);

export interface TextGenerationTaskInput {
  text: string;
  model: Model;
}
export class TextGenerationTask extends ModelFactoryTask {
  declare input: TextGenerationTaskInput;
  constructor(config: TaskConfig = {}, input: TextGenerationTaskInput) {
    super(config, input);
    const { text, model } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_TextGenerationTask(this.config, {
        text,
        model,
      });
    }
  }
}
Task.all.set("TextGenerationTask", TextGenerationTask);

export class SummarizeTask extends ModelFactoryTask {
  declare input: TextGenerationTaskInput;
  constructor(config: TaskConfig = {}, input: TextGenerationTaskInput) {
    super(config, input);
    const { text, model } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_SummarizationTask(this.config, {
        text,
        model,
      });
    }
  }
}
Task.all.set("SummarizeTask", SummarizeTask);

export interface RewriterTaskInput {
  text: string;
  prompt: string;
  model: Model;
}

export class RewriterTask extends ModelFactoryTask {
  declare input: RewriterTaskInput;
  constructor(config: TaskConfig = {}, input: RewriterTaskInput) {
    super(config, input);
    const { text, model, prompt } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_TextRewriterTask(this.config, {
        text,
        prompt,
        model,
      });
    }
  }
}
Task.all.set("RewriterTask", RewriterTask);

export interface QuestionAnswerTaskInput {
  text: string;
  context: string;
  model: Model;
}
export class QuestionAnswerTask extends ModelFactoryTask {
  declare input: QuestionAnswerTaskInput;
  constructor(config: TaskConfig = {}, input: QuestionAnswerTaskInput) {
    super(config, input);
    const { text, model, context } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_QuestionAnswerTask(this.config, {
        text,
        context,
        model,
      });
    }
  }
}
Task.all.set("QuestionAnswerTask", QuestionAnswerTask);

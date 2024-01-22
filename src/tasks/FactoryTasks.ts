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
  HuggingFaceLocal_DownloadTask,
} from "./HuggingFaceLocalTasks";
import {
  MediaPipeTfJsLocal_DownloadTask,
  MediaPipeTfJsLocal_EmbeddingTask,
  MediaPipeTfJsModel,
} from "./MediaPipeLocalTasks";

export interface ModelFactoryTaskInput {
  model: Model;
}

abstract class ModelFactoryTask extends Task {
  declare input: ModelFactoryTaskInput;
  constructor(config: TaskConfig = {}, defaults: ModelFactoryTaskInput) {
    super(config, defaults);
  }

  run(overrides?: TaskInput): Promise<TaskInput> {
    throw new Error("ModelFactoryTask:run() method not implemented.");
  }
}

interface DownloadTaskInput {
  model: Model;
}

export class DownloadTask extends ModelFactoryTask {
  declare input: DownloadTaskInput;
  readonly type = "DownloadTask";
  constructor(config: TaskConfig = {}, defaults: DownloadTaskInput) {
    super(config, defaults);
    const { model } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_DownloadTask(this.config, { model });
    }
    if (model instanceof MediaPipeTfJsModel) {
      return new MediaPipeTfJsLocal_DownloadTask(this.config, { model });
    }
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
  readonly type = "EmbeddingTask";
  constructor(config: TaskConfig = {}, defaults: EmbeddingTaskInput) {
    super(config, defaults);
    const { text, model } = this.input;
    if (model instanceof ONNXTransformerJsModel) {
      return new HuggingFaceLocal_EmbeddingTask(this.config, { text, model });
    }
    if (model instanceof MediaPipeTfJsModel) {
      return new MediaPipeTfJsLocal_EmbeddingTask(this.config, { text, model });
    }
  }
}

export interface TextGenerationTaskInput {
  text: string;
  model: Model;
}
export class TextGenerationTask extends ModelFactoryTask {
  readonly type = "TextGenerationTask";
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

export class SummarizeTask extends ModelFactoryTask {
  declare input: TextGenerationTaskInput;
  readonly type = "SummarizeTask";
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

export interface RewriterTaskInput {
  text: string;
  prompt: string;
  model: Model;
}

export class RewriterTask extends ModelFactoryTask {
  readonly type = "RewriterTask";
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

export interface QuestionAnswerTaskInput {
  text: string;
  context: string;
  model: Model;
}
export class QuestionAnswerTask extends ModelFactoryTask {
  declare input: QuestionAnswerTaskInput;
  readonly type = "QuestionAnswerTask";
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

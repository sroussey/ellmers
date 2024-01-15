//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { ONNXTransformerJsModel } from "#/Model";
import { Task } from "#/Task";
import {
  pipeline,
  type PipelineType,
  type FeatureExtractionPipeline,
  type TextGenerationPipeline,
  type TextGenerationSingle,
  type SummarizationPipeline,
  type SummarizationSingle,
  type QuestionAnsweringPipeline,
  type DocumentQuestionAnsweringSingle,
} from "@sroussey/transformers";

/**
 *
 * This is a helper function to get a pipeline for a model and assign a
 * progress callback to the task.
 *
 * @param task
 * @param model
 * @param options
 */
const getPipeline = async (
  task: Task,
  model: ONNXTransformerJsModel,
  { quantized, config }: { quantized: boolean; config: any } = {
    quantized: true,
    config: null,
  }
) => {
  return await pipeline(model.pipeline as PipelineType, model.name, {
    quantized,
    config,
    progress_callback: ({ progress }: { progress: number }) => {
      task.progress = progress;
      task.emit("progress", progress);
    },
  });
};

export class DownloadTask extends Task {
  readonly model: ONNXTransformerJsModel;
  constructor(input: { model: ONNXTransformerJsModel; name?: string }) {
    super({ name: input.name || `Downloading ${input.model.name}` });
    this.model = input.model;
  }

  public async run() {
    this.emit("start");
    await getPipeline(this, this.model);
    this.emit("complete");
  }
}

/**
 * This is a task that generates an embedding for a single piece of text
 *
 * Model pipeline must be "feature-extraction"
 */
export class HuggingFaceLocal_EmbeddingTask extends Task {
  readonly text: string;
  readonly model: ONNXTransformerJsModel;
  constructor(input: {
    text: string;
    model: ONNXTransformerJsModel;
    name?: string;
  }) {
    super({
      name:
        input.name ||
        `Embedding content via ${input.model.name} : ${input.model.pipeline}`,
    });
    this.model = input.model;
    this.text = input.text;
  }

  public async run() {
    this.emit("start");

    const generateEmbedding = (await getPipeline(
      this,
      this.model
    )) as FeatureExtractionPipeline;

    var vector = await generateEmbedding(this.text, {
      pooling: "mean",
      normalize: this.model.normalize,
    });

    if (vector.size !== this.model.dimensions) {
      this.emit(
        "error",
        `Embedding vector length does not match model dimensions v${vector.size} != m${this.model.dimensions}`
      );
    } else {
      this.output = vector;
      this.emit("complete");
    }
    this.output = Array.from(vector.data);
  }
}

abstract class TextGenerationTaskBase extends Task {
  protected readonly text: string;
  protected readonly model: ONNXTransformerJsModel;
  constructor(input: {
    text: string;
    model: ONNXTransformerJsModel;
    name?: string;
  }) {
    super({
      name:
        input.name ||
        `Text to text generation content via ${input.model.name} : ${input.model.pipeline}`,
    });
    this.model = input.model;
    this.text = input.text;
  }
}

/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export class HuggingFaceLocal_TextGenerationTask extends TextGenerationTaskBase {
  public async run() {
    this.emit("start");

    const generateTextToText = (await getPipeline(
      this,
      this.model
    )) as TextGenerationPipeline;

    let results = await generateTextToText(this.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = (results[0] as TextGenerationSingle)?.generated_text;
    this.emit("complete");
  }
}

/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "summarization"
 */

export class HuggingFaceLocal_SummarizationTask extends TextGenerationTaskBase {
  public async run() {
    this.emit("start");

    const generateSummary = (await getPipeline(
      this,
      this.model
    )) as SummarizationPipeline;

    let results = await generateSummary(this.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = (results[0] as SummarizationSingle)?.summary_text;
    this.emit("complete");
  }
}

/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "question-answering"
 */
export class HuggingFaceLocal_QuestionAnswerTask extends TextGenerationTaskBase {
  protected readonly context: string;
  constructor(input: {
    text: string;
    context: string;
    model: ONNXTransformerJsModel;
    name?: string;
  }) {
    super({
      name:
        input.name ||
        `Question and Answer content via ${input.model.name} : ${input.model.pipeline}`,
      text: input.text,
      model: input.model,
    });
    this.context = input.context;
  }

  public async run() {
    this.emit("start");

    const generateAnswer = (await getPipeline(
      this,
      this.model
    )) as QuestionAnsweringPipeline;

    let results = await generateAnswer(this.text, this.context, { topk: 1 });
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = (results[0] as DocumentQuestionAnsweringSingle)?.answer;
    this.emit("complete");
  }
}

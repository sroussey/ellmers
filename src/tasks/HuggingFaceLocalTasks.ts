//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model, ModelProcessorType } from "#/Model";
import { ITask, Task } from "#/Task";
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

export class ONNXTransformerJsModel extends Model {
  constructor(
    name: string,
    public pipeline: string,
    options?: Partial<Pick<ONNXTransformerJsModel, "dimensions" | "parameters">>
  ) {
    super(name, options);
  }
  readonly type = ModelProcessorType.LOCAL_ONNX_TRANSFORMERJS;
}

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
    progress_callback: (details: {
      file: string;
      status: string;
      name: string;
      progress: number;
      loaded: number;
      total: number;
    }) => {
      const { progress, file } = details;
      task.progress = progress;
      task.emit("progress", progress, file);
    },
  });
};

// ===============================================================================

export class DownloadTask extends Task {
  readonly model: ONNXTransformerJsModel;
  constructor(
    config: Partial<ITask>,
    input: { model: ONNXTransformerJsModel }
  ) {
    config.name = config.name || `Downloading ${input.model.name}`;
    super(config, input);
    this.model = input.model;
  }

  public async run() {
    try {
      this.emit("start");
      await getPipeline(this, this.model);
      this.emit("complete");
    } catch (e) {
      this.emit("error", String(e));
    }
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
  constructor(
    config: Partial<ITask>,
    input: { text: string; model: ONNXTransformerJsModel }
  ) {
    config.name = config.name || `Embedding content via ${input.model.name}`;
    super(config, input);
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
      this.output = { vector: vector.data };
      this.emit("complete");
    }
  }
}

abstract class TextGenerationTaskBase extends Task {
  protected text: string;
  protected model: ONNXTransformerJsModel;
  constructor(
    config: Partial<ITask>,
    input: { text: string; model: ONNXTransformerJsModel }
  ) {
    super(
      {
        ...config,
        name:
          config.name ||
          `Text to text generation content via ${input.model.name} : ${input.model.pipeline}`,
      },
      input
    );
    this.model = input.model;
    this.text = input.text;
  }
}

/**
 * This generates text from a prompt
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export class HuggingFaceLocal_TextGenerationTask extends TextGenerationTaskBase {
  public async run() {
    this.emit("start");

    const generateText = (await getPipeline(
      this,
      this.model
    )) as TextGenerationPipeline;

    let results = await generateText(this.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = {
      text: (results[0] as TextGenerationSingle)?.generated_text,
    };
    this.emit("complete");
  }
}

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export class HuggingFaceLocal_TextRewriterTask extends TextGenerationTaskBase {
  protected prompt: string;
  constructor(
    config: Partial<ITask>,
    input: {
      text: string;
      prompt: string;
      model: ONNXTransformerJsModel;
    }
  ) {
    const { text, prompt, model } = input;
    config.name =
      config.name ||
      `Text to text rewriting content via ${model.name} : ${model.pipeline}`;
    super(config, input);
    this.prompt = prompt;
    this.text = text;
  }
  public async run() {
    this.emit("start");

    const generateText = (await getPipeline(
      this,
      this.model
    )) as TextGenerationPipeline;

    // This lib doesn't support this kind of rewriting
    const promptedtext = (this.prompt ? this.prompt + "\n" : "") + this.text;
    let results = await generateText(promptedtext);
    if (!Array.isArray(results)) {
      results = [results];
    }

    const text = (results[0] as TextGenerationSingle)?.generated_text;
    if (text == promptedtext) {
      this.output = null;
      this.emit("error", "Rewriter failed to generate new text");
    } else {
      this.output = { text };
      this.emit("complete");
    }
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

    this.output = { text: (results[0] as SummarizationSingle)?.summary_text };
    this.emit("complete");
  }
}

/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "question-answering"
 */
export class HuggingFaceLocal_QuestionAnswerTask extends TextGenerationTaskBase {
  protected context: string;
  constructor(
    config: Partial<ITask>,
    input: {
      text: string;
      context: string;
      model: ONNXTransformerJsModel;
    }
  ) {
    config.name =
      config.name || `Question and Answer content via ${input.model.name}`;
    super(config, input);
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

    this.output = {
      text: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
    };
    this.emit("complete");
  }
}

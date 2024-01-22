//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import { Model, ModelProcessorEnum, ModelUseCaseEnum } from "#/Model";
import { StreamableTaskType, Task, TaskConfig } from "#/Task";
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
  env,
} from "@sroussey/transformers";

env.backends.onnx.logLevel = "error";
env.backends.onnx.debug = false;

export class ONNXTransformerJsModel extends Model {
  constructor(
    name: string,
    useCase: ModelUseCaseEnum[],
    public pipeline: string,
    options?: Partial<Pick<ONNXTransformerJsModel, "dimensions" | "parameters">>
  ) {
    super(name, useCase, options);
  }
  readonly type = ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS;
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

interface DownloadTaskInput {
  model: ONNXTransformerJsModel;
}
export class HuggingFaceLocal_DownloadTask extends Task {
  declare input: DownloadTaskInput;
  declare defaults: Partial<DownloadTaskInput>;
  readonly type: StreamableTaskType = "DownloadTask";
  constructor(config: TaskConfig = {}, defaults: DownloadTaskInput) {
    config.name ||= `Downloading ${defaults.model.name}`;
    super(config, defaults);
  }

  public async run(overrides?: Partial<DownloadTaskInput>) {
    this.input = this.withDefaults(overrides);
    try {
      this.emit("start");
      await getPipeline(this, this.input.model);
      this.emit("complete");
    } catch (e) {
      this.emit("error", String(e));
    }
    return this.output;
  }
}

// ===============================================================================

interface EmbeddingTaskInput {
  text: string;
  model: ONNXTransformerJsModel;
}
/**
 * This is a task that generates an embedding for a single piece of text
 *
 * Model pipeline must be "feature-extraction"
 */
export class HuggingFaceLocal_EmbeddingTask extends Task {
  declare input: EmbeddingTaskInput;
  declare defaults: Partial<EmbeddingTaskInput>;
  readonly type: StreamableTaskType = "EmbeddingTask";
  constructor(config: TaskConfig = {}, defaults: EmbeddingTaskInput) {
    config.name ||= `Embedding content via ${defaults.model.name}`;
    config.output_name ||= "vector";
    super(config, defaults);
  }

  public async run(overrides?: Partial<EmbeddingTaskInput>) {
    this.input = this.withDefaults(overrides);

    this.emit("start");

    const generateEmbedding = (await getPipeline(
      this,
      this.input.model
    )) as FeatureExtractionPipeline;

    var vector = await generateEmbedding(this.input.text, {
      pooling: "mean",
      normalize: this.input.model.normalize,
    });

    if (vector.size !== this.input.model.dimensions) {
      this.emit(
        "error",
        `Embedding vector length does not match model dimensions v${vector.size} != m${this.input.model.dimensions}`
      );
    } else {
      this.output = { [this.config.output_name]: vector.data };
      this.emit("complete");
    }
    return this.output;
  }
}

// ===============================================================================

interface TextGenerationTaskInput {
  text: string;
  model: ONNXTransformerJsModel;
}
abstract class TextGenerationTaskBase extends Task {
  declare input: TextGenerationTaskInput;
  constructor(config: TaskConfig = {}, input: TextGenerationTaskInput) {
    config.name ||= `Text generation content via ${input.model.name} : ${input.model.pipeline}`;
    config.output_name ||= "text";
    super(config, input);
  }
}

// ===============================================================================

/**
 * This generates text from a prompt
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export class HuggingFaceLocal_TextGenerationTask extends TextGenerationTaskBase {
  readonly type: StreamableTaskType = "TextGenerationTask";
  public async run(overrides?: Partial<TextGenerationTaskInput>) {
    this.input = this.withDefaults(overrides);

    this.emit("start");

    const generateText = (await getPipeline(
      this,
      this.input.model
    )) as TextGenerationPipeline;

    let results = await generateText(this.input.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = {
      [this.config.output_name]: (results[0] as TextGenerationSingle)
        ?.generated_text,
    };
    this.emit("complete");
    return this.output;
  }
}

// ===============================================================================

interface RewriterTaskInput {
  text: string;
  prompt: string;
  model: ONNXTransformerJsModel;
}

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export class HuggingFaceLocal_TextRewriterTask extends TextGenerationTaskBase {
  declare input: RewriterTaskInput;
  readonly type: StreamableTaskType = "RewriterTask";
  constructor(config: TaskConfig = {}, input: RewriterTaskInput) {
    const { model } = input;
    config.name ||= `Text to text rewriting content via ${model.name} : ${model.pipeline}`;
    config.output_name ||= "text";
    super(config, input);
  }

  public async run(overrides?: Partial<RewriterTaskInput>) {
    this.input = this.withDefaults(overrides);
    this.emit("start");

    const generateText = (await getPipeline(
      this,
      this.input.model
    )) as TextGenerationPipeline;

    // This lib doesn't support this kind of rewriting with a separate prompt vs text
    const promptedtext =
      (this.input.prompt ? this.input.prompt + "\n" : "") + this.input.text;
    let results = await generateText(promptedtext);
    if (!Array.isArray(results)) {
      results = [results];
    }

    const text = (results[0] as TextGenerationSingle)?.generated_text;
    if (text == promptedtext) {
      this.output = {};
      this.emit("error", "Rewriter failed to generate new text");
    } else {
      this.output = { [this.config.output_name]: text };
      this.emit("complete");
    }

    return this.output;
  }
}

// ===============================================================================

/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "summarization"
 */

export class HuggingFaceLocal_SummarizationTask extends TextGenerationTaskBase {
  readonly type: StreamableTaskType = "SummarizeTask";
  public async run(overrides?: Partial<TextGenerationTaskInput>) {
    this.emit("start");

    this.input = this.withDefaults(overrides);

    const generateSummary = (await getPipeline(
      this,
      this.input.model
    )) as SummarizationPipeline;

    let results = await generateSummary(this.input.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = {
      [this.config.output_name]: (results[0] as SummarizationSingle)
        ?.summary_text,
    };
    this.emit("complete");
    return this.output;
  }
}

// ===============================================================================

interface QuestionAnswerTaskInput {
  text: string;
  context: string;
  model: ONNXTransformerJsModel;
  topk?: number;
}
/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "question-answering"
 */
export class HuggingFaceLocal_QuestionAnswerTask extends TextGenerationTaskBase {
  declare input: QuestionAnswerTaskInput;
  readonly type: StreamableTaskType = "QuestionAnswerTask";
  constructor(config: TaskConfig = {}, input: QuestionAnswerTaskInput) {
    config.name =
      config.name || `Question and Answer content via ${input.model.name}`;
    config.output_name ||= "text";
    super(config, input);
  }

  public async run(overrides?: Partial<QuestionAnswerTaskInput>) {
    this.emit("start");

    this.input = this.withDefaults(overrides);

    const generateAnswer = (await getPipeline(
      this,
      this.input.model
    )) as QuestionAnsweringPipeline;

    let results = await generateAnswer(this.input.text, this.input.context, {
      topk: this.input.topk ?? 1,
    });
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = {
      [this.config.output_name]: (results[0] as DocumentQuestionAnsweringSingle)
        ?.answer,
    };
    this.emit("complete");
    return this.output;
  }
}

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

interface DownloadTaskInput {
  model: ONNXTransformerJsModel;
}
export class DownloadTask extends Task {
  declare input: DownloadTaskInput;
  constructor(config: Partial<ITask>, input: DownloadTaskInput) {
    config.name ||= `Downloading ${input.model.name}`;
    super(config, input);
  }

  public async run(input?: DownloadTaskInput) {
    try {
      this.emit("start");
      input = Object.assign({}, this.input, input);
      await getPipeline(this, input.model);
      this.emit("complete");
    } catch (e) {
      this.emit("error", String(e));
    }
  }
}

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
  constructor(config: Partial<ITask>, input: EmbeddingTaskInput) {
    config.name ||= `Embedding content via ${input.model.name}`;
    super(config, input);
  }

  public async run(input?: EmbeddingTaskInput) {
    this.emit("start");

    input = Object.assign({}, this.input, input);

    const generateEmbedding = (await getPipeline(
      this,
      input.model
    )) as FeatureExtractionPipeline;

    var vector = await generateEmbedding(input.text, {
      pooling: "mean",
      normalize: input.model.normalize,
    });

    if (vector.size !== input.model.dimensions) {
      this.emit(
        "error",
        `Embedding vector length does not match model dimensions v${vector.size} != m${input.model.dimensions}`
      );
    } else {
      this.output = { vector: vector.data };
      this.emit("complete");
    }
  }
}

interface TextGenerationTaskInput {
  text: string;
  model: ONNXTransformerJsModel;
}
abstract class TextGenerationTaskBase extends Task {
  declare input: TextGenerationTaskInput;
  constructor(config: Partial<ITask>, input: TextGenerationTaskInput) {
    config.name ||= `Text generation content via ${input.model.name} : ${input.model.pipeline}`;
    super(config, input);
  }
}

/**
 * This generates text from a prompt
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export class HuggingFaceLocal_TextGenerationTask extends TextGenerationTaskBase {
  public async run(input?: TextGenerationTaskInput) {
    this.emit("start");

    input = Object.assign({}, this.input, input);

    const generateText = (await getPipeline(
      this,
      input.model
    )) as TextGenerationPipeline;

    let results = await generateText(input.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = {
      text: (results[0] as TextGenerationSingle)?.generated_text,
    };
    this.emit("complete");
  }
}

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
  constructor(config: Partial<ITask>, input: RewriterTaskInput) {
    const { model } = input;
    config.name ||= `Text to text rewriting content via ${model.name} : ${model.pipeline}`;
    super(config, input);
  }

  public async run(input?: RewriterTaskInput) {
    this.emit("start");

    input = Object.assign({}, this.input, input);

    const generateText = (await getPipeline(
      this,
      input.model
    )) as TextGenerationPipeline;

    // This lib doesn't support this kind of rewriting
    const promptedtext = (input.prompt ? input.prompt + "\n" : "") + input.text;
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
  public async run(input?: TextGenerationTaskInput) {
    this.emit("start");

    input = Object.assign({}, this.input, input);

    const generateSummary = (await getPipeline(
      this,
      input.model
    )) as SummarizationPipeline;

    let results = await generateSummary(input.text);
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = { text: (results[0] as SummarizationSingle)?.summary_text };
    this.emit("complete");
  }
}

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
  constructor(config: Partial<ITask>, input: QuestionAnswerTaskInput) {
    config.name =
      config.name || `Question and Answer content via ${input.model.name}`;
    super(config, input);
  }

  public async run(input?: QuestionAnswerTaskInput) {
    this.emit("start");

    input = Object.assign({}, this.input, input);

    const generateAnswer = (await getPipeline(
      this,
      input.model
    )) as QuestionAnsweringPipeline;

    let results = await generateAnswer(input.text, input.context, {
      topk: input.topk ?? 1,
    });
    if (!Array.isArray(results)) {
      results = [results];
    }

    this.output = {
      text: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
    };
    this.emit("complete");
  }
}

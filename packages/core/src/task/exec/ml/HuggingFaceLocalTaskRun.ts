//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

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
import { ModelFactory } from "../../ModelFactory";
import {
  DownloadTask,
  DownloadTaskInput,
  EmbeddingTask,
  EmbeddingTaskInput,
  QuestionAnswerTask,
  QuestionAnswerTaskInput,
  TextRewriterTaskInput,
  SummarizeTask,
  SummarizeTaskInput,
  TextGenerationTask,
  TextGenerationTaskInput,
  TextRewriterTask,
  DownloadTaskOutput,
  EmbeddingTaskOutput,
  TextGenerationTaskOutput,
  TextRewriterTaskOutput,
  SummarizeTaskOutput,
  QuestionAnswerTaskOutput,
} from "../../ModelFactoryTasks";
import { findModelByName } from "../../../storage/InMemoryStorage";
import { ONNXTransformerJsModel } from "../../../model/HuggingFaceModel";
import { ModelProcessorEnum } from "../../../model/Model";
import { Vector } from "../../TaskIOTypes";
import { SingleTask } from "../../Task";

env.backends.onnx.logLevel = "error";
env.backends.onnx.debug = false;

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
  task: SingleTask,
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

/**
 * This is a task that downloads and caches an onnx model.
 */

export async function HuggingFaceLocal_DownloadRun(
  task: DownloadTask,
  runInputData: DownloadTaskInput
): Promise<DownloadTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;
  await getPipeline(task, model!);
  return { model: model.name };
}

/**
 * This is a task that generates an embedding for a single piece of text
 *
 * Model pipeline must be "feature-extraction"
 */
export async function HuggingFaceLocal_EmbeddingRun(
  task: EmbeddingTask,
  runInputData: EmbeddingTaskInput
): Promise<EmbeddingTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;
  const generateEmbedding = (await getPipeline(task, model)) as FeatureExtractionPipeline;

  var vector = await generateEmbedding(runInputData.text, {
    pooling: "mean",
    normalize: model.normalize,
  });

  if (vector.size !== model.dimensions) {
    throw `Embedding vector length does not match model dimensions v${vector.size} != m${model.dimensions}`;
  }
  return { vector: vector.data as Vector };
}

/**
 * This generates text from a prompt
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export async function HuggingFaceLocal_TextGenerationRun(
  task: TextGenerationTask,
  runInputData: TextGenerationTaskInput
): Promise<TextGenerationTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;

  const generateText = (await getPipeline(task, model)) as TextGenerationPipeline;

  let results = await generateText(runInputData.prompt);
  if (!Array.isArray(results)) {
    results = [results];
  }
  return {
    text: (results[0] as TextGenerationSingle)?.generated_text,
  };
}

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 *
 * Model pipeline must be "text-generation" or "text2text-generation"
 */
export async function HuggingFaceLocal_TextRewriterRun(
  task: TextRewriterTask,
  runInputData: TextRewriterTaskInput
): Promise<TextRewriterTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;

  const generateText = (await getPipeline(task, model)) as TextGenerationPipeline;

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedtext = (runInputData.prompt ? runInputData.prompt + "\n" : "") + runInputData.text;
  let results = await generateText(promptedtext);
  if (!Array.isArray(results)) {
    results = [results];
  }

  const text = (results[0] as TextGenerationSingle)?.generated_text;
  if (text == promptedtext) {
    throw "Rewriter failed to generate new text";
  }

  return { text };
}

/**
 * This summarizes a piece of text
 *
 * Model pipeline must be "summarization"
 */

export async function HuggingFaceLocal_SummarizeRun(
  task: SummarizeTask,
  runInputData: SummarizeTaskInput
): Promise<SummarizeTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;

  const generateSummary = (await getPipeline(task, model)) as SummarizationPipeline;

  let results = await generateSummary(runInputData.text);
  if (!Array.isArray(results)) {
    results = [results];
  }

  return {
    text: (results[0] as SummarizationSingle)?.summary_text,
  };
}

/**
 * This is a special case of text generation that takes a context and a question
 *
 * Model pipeline must be "question-answering"
 */
export async function HuggingFaceLocal_QuestionAnswerRun(
  task: QuestionAnswerTask,
  runInputData: QuestionAnswerTaskInput
): Promise<QuestionAnswerTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;

  const generateAnswer = (await getPipeline(task, model)) as QuestionAnsweringPipeline;

  let results = await generateAnswer(runInputData.question, runInputData.context);
  if (!Array.isArray(results)) {
    results = [results];
  }

  return {
    answer: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
  };
}

export async function registerHuggingfaceLocalTasks() {
  ModelFactory.registerRunFn(
    DownloadTask,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_DownloadRun
  );

  ModelFactory.registerRunFn(
    EmbeddingTask,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_EmbeddingRun
  );

  ModelFactory.registerRunFn(
    TextGenerationTask,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextGenerationRun
  );

  ModelFactory.registerRunFn(
    TextRewriterTask,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextRewriterRun
  );

  ModelFactory.registerRunFn(
    SummarizeTask,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_SummarizeRun
  );

  ModelFactory.registerRunFn(
    QuestionAnswerTask,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_QuestionAnswerRun
  );
}

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
import { findModelByName } from "../../storage/InMemoryStorage";
import { ONNXTransformerJsModel, ModelProcessorEnum } from "model";
import {
  Vector,
  DownloadTask,
  DownloadTaskInput,
  DownloadTaskOutput,
  EmbeddingTask,
  EmbeddingTaskInput,
  EmbeddingTaskOutput,
  TextGenerationTask,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTask,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextQuestionAnswerTask,
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  TextSummaryTask,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  JobQueueLlmTask,
} from "task";

env.backends.onnx.logLevel = "error";
env.backends.onnx.debug = false;

export enum LocalHuggingfaceStatus {
  initiate = "initiate",
  download = "download",
  progress = "progress",
  done = "done",
  ready = "ready",
  update = "update",
  complete = "complete",
}

interface StatusFileBookends {
  status: "initiate" | "download" | "done";
  name: string;
  file: string;
}

interface StatusFileProgress {
  status: "progress";
  name: string;
  file: string;
  loaded: number;
  progress: number;
  total: number;
}

interface StatusRunReady {
  status: "ready";
  model: string;
  task: string;
}
interface StatusRunUpdate {
  status: "update";
  output: string;
}
interface StatusRunComplete {
  status: "complete";
  output: string[];
}

type StatusFile = StatusFileBookends | StatusFileProgress;
type StatusRun = StatusRunReady | StatusRunUpdate | StatusRunComplete;
export type CallbackStatus = StatusFile | StatusRun;

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
  model: ONNXTransformerJsModel,
  callback: (status: CallbackStatus) => void,
  { quantized, config }: { quantized: boolean; config: any } = {
    quantized: true,
    config: null,
  }
) => {
  return await pipeline(model.pipeline as PipelineType, model.name, {
    quantized,
    config,
    progress_callback: callback,
  });
};

function downloadProgressCallback(task: JobQueueLlmTask) {
  return (status: CallbackStatus) => {
    if (status.status === "progress") {
      task.progress = status.progress;
      task.emit("progress", status.progress, status.file);
    } else if (status.status === "ready") {
      task.progress = 100;
      task.emit("complete");
    }
  };
}

function runProgressCallback(task: JobQueueLlmTask) {
  return (status: CallbackStatus) => {
    if (status.status === "progress") {
      task.progress = status.progress / 2;
      task.emit("progress", status.progress, status.file);
    }
    if (status.status === "update") {
      task.progress = 55;
      task.emit("progress", task.progress, status.output);
    }
    if (status.status === "complete") {
      task.progress = 100;
      task.emit("complete", status.output);
    }
  };
}

// ===============================================================================

/**
 * This is a task that downloads and caches an onnx model.
 */

export async function HuggingFaceLocal_DownloadRun(
  task: DownloadTask,
  runInputData: DownloadTaskInput
): Promise<DownloadTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;
  await getPipeline(model!, downloadProgressCallback(task));
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
  const generateEmbedding = (await getPipeline(
    model,
    runProgressCallback(task)
  )) as FeatureExtractionPipeline;

  var vector = await generateEmbedding(runInputData.text, {
    pooling: "mean",
    normalize: model.normalize,
  });

  if (vector.size !== model.dimensions) {
    console.warn(
      `HuggingFaceLocal Embedding vector length does not match model dimensions v${vector.size} != m${model.dimensions}`,
      runInputData,
      vector
    );
    throw `HuggingFaceLocal Embedding vector length does not match model dimensions v${vector.size} != m${model.dimensions}`;
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

  const generateText = (await getPipeline(
    model,
    runProgressCallback(task)
  )) as TextGenerationPipeline;

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

  const generateText = (await getPipeline(
    model,
    runProgressCallback(task)
  )) as TextGenerationPipeline;

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

export async function HuggingFaceLocal_TextSummaryRun(
  task: TextSummaryTask,
  runInputData: TextSummaryTaskInput
): Promise<TextSummaryTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;

  const generateSummary = (await getPipeline(
    model,
    runProgressCallback(task)
  )) as SummarizationPipeline;

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
export async function HuggingFaceLocal_TextQuestionAnswerRun(
  task: TextQuestionAnswerTask,
  runInputData: TextQuestionAnswerTaskInput
): Promise<TextQuestionAnswerTaskOutput> {
  const model = findModelByName(runInputData.model) as ONNXTransformerJsModel;

  const generateAnswer = (await getPipeline(
    model,
    runProgressCallback(task)
  )) as QuestionAnsweringPipeline;

  let results = await generateAnswer(runInputData.question, runInputData.context);
  if (!Array.isArray(results)) {
    results = [results];
  }

  return {
    answer: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
  };
}

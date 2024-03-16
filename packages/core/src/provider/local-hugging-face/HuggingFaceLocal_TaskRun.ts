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
import { ONNXTransformerJsModel } from "model";
import {
  Vector,
  DownloadModelTask,
  DownloadModelTaskInput,
  DownloadModelTaskOutput,
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

env.cacheDir = "./.cache";

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

const pipelines = new Map<ONNXTransformerJsModel, any>();

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
  task: JobQueueLlmTask,
  model: ONNXTransformerJsModel,
  { quantized, config, session_options }: any = {
    quantized: true,
    session_options: { logSeverityLevel: 4 },
  }
) => {
  if (!pipelines.has(model)) {
    pipelines.set(
      model,
      await pipeline(model.pipeline as PipelineType, model.name, {
        quantized,
        session_options,
        progress_callback: downloadProgressCallback(task),
      })
    );
  }
  return pipelines.get(model);
};

function downloadProgressCallback(task: JobQueueLlmTask) {
  return (status: CallbackStatus) => {
    if (status.status === "progress") {
      task.progress = status.progress;
      task.emit("progress", status.progress, status.file);
    }
  };
}

function generateProgressCallback(task: JobQueueLlmTask, instance: any) {
  return (beams: any[]) => {
    const decodedText = instance.tokenizer.decode(beams[0].output_token_ids, {
      skip_special_tokens: true,
    });
    task.progress = 60;
    task.emit("progress", decodedText);
  };
}

// ===============================================================================

/**
 * This is a task that downloads and caches an onnx model.
 */

export async function HuggingFaceLocal_DownloadRun(
  task: DownloadModelTask,
  runInputData: DownloadModelTaskInput
): Promise<DownloadModelTaskOutput> {
  const model = findModelByName(runInputData.model)! as ONNXTransformerJsModel;
  await getPipeline(task, model);
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
  const generateEmbedding: FeatureExtractionPipeline = await getPipeline(task, model);

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

  const generateText: TextGenerationPipeline = await getPipeline(task, model);

  let results = await generateText(runInputData.prompt, {
    callback_function: generateProgressCallback(task, generateText),
  } as any);
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

  const generateText: TextGenerationPipeline = await getPipeline(task, model);

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedtext = (runInputData.prompt ? runInputData.prompt + "\n" : "") + runInputData.text;
  let results = await generateText(promptedtext, {
    callback_function: generateProgressCallback(task, generateText),
  } as any);
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

  const generateSummary: SummarizationPipeline = await getPipeline(task, model);

  let results = await generateSummary(runInputData.text, {
    callback_function: generateProgressCallback(task, generateSummary),
  } as any);
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

  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(task, model);

  let results = await generateAnswer(runInputData.question, runInputData.context, {
    callback_function: generateProgressCallback(task, generateAnswer),
  } as any);
  if (!Array.isArray(results)) {
    results = [results];
  }

  return {
    answer: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
  };
}

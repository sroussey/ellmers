//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  pipeline,
  env,
  type PipelineType,
  type FeatureExtractionPipeline,
  type TextGenerationPipeline,
  type TextGenerationSingle,
  type SummarizationPipeline,
  type SummarizationSingle,
  type QuestionAnsweringPipeline,
  type DocumentQuestionAnsweringSingle,
  type TranslationPipeline,
  type TranslationSingle,
  TextStreamer,
} from "@huggingface/transformers";
import { ElVector, getGlobalModelRepository } from "ellmers-ai";
import type {
  JobQueueLlmTask,
  DownloadModelTask,
  DownloadModelTaskInput,
  DownloadModelTaskOutput,
  TextEmbeddingTask,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
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
  TextTranslationTask,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  Model,
} from "ellmers-ai";
import { QUANTIZATION_DATA_TYPES } from "../model/ONNXTransformerJsModel";

// @ts-ignore
const IS_WEBGPU_AVAILABLE = !!globalThis.navigator?.gpu;

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

const pipelines = new Map<Model, any>();

/**
 *
 * This is a helper function to get a pipeline for a model and assign a
 * progress callback to the task.
 *
 * @param task
 * @param model
 * @param options
 */
const getPipeline = async (task: JobQueueLlmTask, model: Model, options: any = {}) => {
  if (!pipelines.has(model)) {
    pipelines.set(
      model,
      pipeline(model.pipeline as PipelineType, model.url, {
        dtype: (model.quantization as QUANTIZATION_DATA_TYPES) || "q8",
        session_options: options?.session_options,
        progress_callback: downloadProgressCallback(task),
        ...(model.use_external_data_format
          ? { use_external_data_format: model.use_external_data_format }
          : {}),
        ...(model.device && IS_WEBGPU_AVAILABLE ? { device: model.device as any } : {}),
      })
    );
  }
  return await pipelines.get(model);
};

function downloadProgressCallback(task: JobQueueLlmTask) {
  return (status: CallbackStatus) => {
    const progress = status.status === "progress" ? Math.round(status.progress) : 0;
    if (status.status === "progress") {
      task.progress = progress;
      task.emit("progress", progress, status.file);
    }
  };
}

function generateProgressCallback(task: JobQueueLlmTask) {
  let count = 0;
  return (text: string) => {
    count++;
    const result = 100 * (1 - Math.exp(-0.05 * count));
    task.progress = Math.round(Math.min(result, 100));
    task.emit("progress", task.progress, text);
  };
}

// ===============================================================================

/**
 * This is a task that downloads and caches an onnx model.
 */

export async function HuggingFaceLocal_DownloadRun(
  task: DownloadModelTask,
  runInputData: DownloadModelTaskInput
): Promise<Partial<DownloadModelTaskOutput>> {
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;
  await getPipeline(task, model);
  return { model: model.name, dimensions: model.nativeDimensions || 0, normalize: model.normalize };
}

/**
 * This is a task that generates an embedding for a single piece of text
 *
 * Model pipeline must be "feature-extraction"
 */
export async function HuggingFaceLocal_EmbeddingRun(
  task: TextEmbeddingTask,
  runInputData: TextEmbeddingTaskInput
): Promise<TextEmbeddingTaskOutput> {
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;
  const generateEmbedding: FeatureExtractionPipeline = await getPipeline(task, model);

  const hfVector = await generateEmbedding(runInputData.text, {
    pooling: "mean",
    normalize: model.normalize,
  });

  if (hfVector.size !== model.nativeDimensions) {
    console.warn(
      `HuggingFaceLocal Embedding vector length does not match model dimensions v${hfVector.size} != m${model.nativeDimensions}`,
      runInputData,
      hfVector
    );
    throw `HuggingFaceLocal Embedding vector length does not match model dimensions v${hfVector.size} != m${model.nativeDimensions}`;
  }
  const vector = new ElVector(hfVector.data, model.normalize ?? true);
  return { vector };
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
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;

  const generateText: TextGenerationPipeline = await getPipeline(task, model);

  const streamer = new TextStreamer(generateText.tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: generateProgressCallback(task),
  });

  let results = await generateText(runInputData.prompt, {
    streamer,
  } as any);
  if (!Array.isArray(results)) {
    results = [results];
  }
  let text = (results[0] as TextGenerationSingle)?.generated_text;

  if (Array.isArray(text)) {
    text = text[text.length - 1]?.content;
  }

  return {
    text,
  };
}

/**
 * Text translation
 *
 * Model pipeline must be "translation"
 */
export async function HuggingFaceLocal_TextTranslationRun(
  task: TextTranslationTask,
  runInputData: TextTranslationTaskInput
): Promise<Partial<TextTranslationTaskOutput>> {
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;

  const translate: TranslationPipeline = await getPipeline(task, model);

  const streamer = new TextStreamer(translate.tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: generateProgressCallback(task),
  });

  let results = await translate(runInputData.text, {
    src_lang: runInputData.source_lang,
    tgt_lang: runInputData.target_lang,
    streamer,
  } as any);
  if (!Array.isArray(results)) {
    results = [results];
  }
  return {
    text: (results[0] as TranslationSingle)?.translation_text,
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
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;

  const generateText: TextGenerationPipeline = await getPipeline(task, model);
  const streamer = new TextStreamer(generateText.tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: generateProgressCallback(task),
  });

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedtext = (runInputData.prompt ? runInputData.prompt + "\n" : "") + runInputData.text;
  let results = await generateText(promptedtext, {
    streamer,
  } as any);
  if (!Array.isArray(results)) {
    results = [results];
  }

  let text = (results[0] as TextGenerationSingle)?.generated_text;
  if (Array.isArray(text)) {
    text = text[text.length - 1]?.content;
  }
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
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;

  const generateSummary: SummarizationPipeline = await getPipeline(task, model);
  const streamer = new TextStreamer(generateSummary.tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: generateProgressCallback(task),
  });

  let results = await generateSummary(runInputData.text, {
    streamer,
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
  const model = (await getGlobalModelRepository().findByName(runInputData.model))!;

  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(task, model);
  const streamer = new TextStreamer(generateAnswer.tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: generateProgressCallback(task),
  });

  let results = await generateAnswer(runInputData.question, runInputData.context, {
    streamer,
  } as any);
  if (!Array.isArray(results)) {
    results = [results];
  }

  return {
    text: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
  };
}

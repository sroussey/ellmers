//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  type FeatureExtractionPipeline,
  type TextGenerationPipeline,
  type TextGenerationSingle,
  type SummarizationPipeline,
  type SummarizationSingle,
  type QuestionAnsweringPipeline,
  type DocumentQuestionAnsweringSingle,
} from "@sroussey/transformers";
import { findModelByName } from "../../storage/InMemoryStorage";
import { ONNXTransformerJsModel } from "model";
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

// Initialize the worker
const worker = new Worker(new URL("./server_worker_hf.js", import.meta.url), { type: "module" });
worker.onerror = (e) => {
  console.error("Worker error:", e.message, new URL("./server_worker_hf.js", import.meta.url));
};

const getPipeline = async (
  task: JobQueueLlmTask,
  model: ONNXTransformerJsModel,
  { quantized, config }: { quantized: boolean; config: any } = {
    quantized: true,
    config: null,
  }
) => {
  const pipeline = model.pipeline;
  const modelName = model.name;
  const id = task.config.id;

  return (...params: any[]) => {
    return new Promise((resolve, reject) => {
      // Listen for a message from the worker
      const listener = (e: MessageEvent<any>) => {
        console.log("main received worker message", e.data);
        if (e.data.id === id) {
          if (e.data.status === "complete") {
            // Unsubscribe listener after getting the final response
            worker.removeEventListener("message", listener);
            resolve(e.data.output);
          } else if (e.data.status === "progress") {
            downloadProgressCallback(task, e.data);
          } else {
            runProgressCallback(task, e.data);
          }
        }
      };
      worker.addEventListener("message", listener);

      console.log("main sending worker ", {
        id,
        pipeline: pipeline,
        model: modelName,
        params: params,
        options: { quantized, config },
      });
      // Send the task request to the worker
      worker.postMessage({
        id,
        pipeline: pipeline,
        model: modelName,
        params: params,
        options: { quantized, config },
      });
    });
  };
};

function downloadProgressCallback(task: JobQueueLlmTask, status: CallbackStatus) {
  if (status.status === "progress") {
    task.progress = status.progress;
    task.emit("progress", status.progress, status.file);
  }
}

function runProgressCallback(task: JobQueueLlmTask, status: CallbackStatus) {
  if (status.status === "update") {
    task.progress = 60;
    task.emit("progress", task.progress, status.output);
  }
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
  const download = await getPipeline(task, model!);
  await download();
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

  const generateText = (await getPipeline(task, model)) as TextGenerationPipeline;

  let results = await generateText(runInputData.prompt, {});
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
  let results = await generateText(promptedtext, {});
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

  const generateSummary = (await getPipeline(task, model)) as SummarizationPipeline;

  let results = await generateSummary(runInputData.text, {});
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

  const generateAnswer = (await getPipeline(task, model)) as QuestionAnsweringPipeline;

  let results = await generateAnswer(runInputData.question, runInputData.context, {});
  if (!Array.isArray(results)) {
    results = [results];
  }

  return {
    answer: (results[0] as DocumentQuestionAnsweringSingle)?.answer,
  };
}

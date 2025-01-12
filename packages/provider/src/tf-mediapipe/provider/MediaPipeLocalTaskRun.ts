//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { FilesetResolver, TextEmbedder } from "@mediapipe/tasks-text";
import { ElVector } from "ellmers-core";
import {
  findModelByName,
  DownloadModelTask,
  DownloadModelTaskInput,
  TextEmbeddingTask,
  TextEmbeddingTaskInput,
} from "ellmers-ai";
import { MediaPipeTfJsModel } from "../model/MediaPipeModel";

/**
 * This is a task that downloads and caches a MediaPipe TFJS model.
 */
export async function MediaPipeTfJsLocal_Download(
  task: DownloadModelTask,
  runInputData: DownloadModelTaskInput
) {
  const textFiles = await FilesetResolver.forTextTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm"
  );
  const model = findModelByName(runInputData.model) as MediaPipeTfJsModel;
  const results = await TextEmbedder.createFromOptions(textFiles, {
    baseOptions: {
      modelAssetPath: model.url,
    },
    quantize: true,
  });

  return results;
}

/**
 * This is a task that generates an embedding for a single piece of text
 * using a MediaPipe TFJS model.
 */
export async function MediaPipeTfJsLocal_Embedding(
  task: TextEmbeddingTask,
  runInputData: TextEmbeddingTaskInput
) {
  const textFiles = await FilesetResolver.forTextTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm"
  );
  const model = findModelByName(runInputData.model) as MediaPipeTfJsModel;
  const textEmbedder = await TextEmbedder.createFromOptions(textFiles, {
    baseOptions: {
      modelAssetPath: model.url,
    },
    quantize: true,
  });

  const output = textEmbedder.embed(runInputData.text);
  const vector = output.embeddings[0].floatEmbedding;

  if (vector?.length !== model.dimensions) {
    throw `MediaPipeTfJsLocal Embedding vector length does not match model dimensions v${vector?.length} != m${model.dimensions}`;
  }
  return { vector: vector ? new ElVector(vector, true) : null };
}

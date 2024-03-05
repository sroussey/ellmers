//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { FilesetResolver, TextEmbedder } from "@mediapipe/tasks-text";
import { ModelFactory } from "../../base/ModelFactory";
import { DownloadTask, DownloadTaskInput } from "../../DownloadModelTask";
import { EmbeddingTask, EmbeddingTaskInput } from "../../TextEmbeddingTask";
import { findModelByName } from "../../../storage/InMemoryStorage";
import { MediaPipeTfJsModel } from "../../../model/MediaPipeModel";
import { ModelProcessorEnum } from "../../../model/Model";

/**
 * This is a task that downloads and caches a MediaPipe TFJS model.
 */
export async function MediaPipeTfJsLocal_DownloadRun(
  task: DownloadTask,
  runInputData: DownloadTaskInput
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
export async function MediaPipeTfJsLocal_EmbeddingRun(
  task: EmbeddingTask,
  runInputData: EmbeddingTaskInput
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
  return { vector };
}

export const registerMediaPipeTfJsLocalTasks = () => {
  ModelFactory.registerRunFn(
    DownloadTask,
    ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_DownloadRun
  );

  ModelFactory.registerRunFn(
    DownloadTask,
    ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_EmbeddingRun
  );
};

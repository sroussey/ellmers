//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  LOCAL_ONNX_TRANSFORMERJS,
  registerHuggingfaceLocalTasks,
} from "@ellmers/ai-provider/hf-transformers";
import {
  MEDIA_PIPE_TFJS_MODEL,
  registerMediaPipeTfJsLocalTasks,
} from "@ellmers/ai-provider/tf-mediapipe";
import { TaskInput, TaskOutput, getTaskQueueRegistry } from "@ellmers/task-graph";
import { InMemoryJobQueue } from "@ellmers/storage/inmemory";
import { AiProviderJob } from "@ellmers/ai";
import { ConcurrencyLimiter } from "@ellmers/job-queue";
export * from "./sample/MediaPipeModelSamples";
export * from "./sample/ONNXModelSamples";

export async function registerHuggingfaceLocalTasksInMemory() {
  registerHuggingfaceLocalTasks();
  const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
    LOCAL_ONNX_TRANSFORMERJS,
    new ConcurrencyLimiter(1, 10),
    AiProviderJob,
    10
  );
  getTaskQueueRegistry().registerQueue(jobQueue);
  jobQueue.start();
}

export async function registerMediaPipeTfJsLocalInMemory() {
  registerMediaPipeTfJsLocalTasks();
  const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
    MEDIA_PIPE_TFJS_MODEL,
    new ConcurrencyLimiter(1, 10),
    AiProviderJob,
    10
  );
  getTaskQueueRegistry().registerQueue(jobQueue);
  jobQueue.start();
}

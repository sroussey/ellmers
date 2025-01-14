//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { ConcurrencyLimiter, TaskInput, TaskOutput } from "ellmers-core";
import { getProviderRegistry, ModelProcessorEnum } from "ellmers-ai";
import { InMemoryJobQueue } from "ellmers-storage/inmemory";
import { registerMediaPipeTfJsLocalTasks } from "../bindings/registerTasks";
import "../model/MediaPipeModelSamples";

const TFQUEUE = "local_tf-mediapipe";

export async function registerMediaPipeTfJsLocalInMemory() {
  registerMediaPipeTfJsLocalTasks();
  const ProviderRegistry = getProviderRegistry();
  const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
    TFQUEUE,
    new ConcurrencyLimiter(1, 10),
    10
  );
  ProviderRegistry.registerQueue(ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL, jobQueue);
  jobQueue.start();
  return ProviderRegistry;
}

describe("TfMediaPipe.", () => {
  it("should not fail", async () => {
    const providerRegistry = await registerMediaPipeTfJsLocalInMemory();
    const queue = providerRegistry.getQueue(ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL);
    expect(queue).toBeDefined();
    expect(queue?.queue).toEqual(TFQUEUE);
  });
});

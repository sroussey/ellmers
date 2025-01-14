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
import { registerHuggingfaceLocalTasks } from "../bindings/registerTasks";
import "../model/ONNXModelSamples";

const HFQUEUE = "local_hf";

export async function registerHuggingfaceLocalTasksInMemory() {
  registerHuggingfaceLocalTasks();
  const providerRegistry = getProviderRegistry();
  const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
    HFQUEUE,
    new ConcurrencyLimiter(1, 10),
    10
  );
  providerRegistry.registerQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS, jobQueue);
  jobQueue.start();
  return providerRegistry;
}

describe("HFTransformersBinding.", () => {
  it("should not fail", async () => {
    const providerRegistry = await registerHuggingfaceLocalTasksInMemory();
    const queue = providerRegistry.getQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS);
    expect(queue).toBeDefined();
    expect(queue?.queue).toEqual(HFQUEUE);
  });
});

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { afterAll, describe, expect, it } from "bun:test";
import {
  ConcurrencyLimiter,
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskGraphBuilder,
  TaskInput,
  TaskOutput,
} from "ellmers-core";
import { AiProviderJob, getGlobalModelRepository, setGlobalModelRepository } from "ellmers-ai";
import { InMemoryJobQueue, InMemoryModelRepository } from "ellmers-storage/inmemory";
import { getDatabase, SqliteJobQueue } from "ellmers-storage/bun/sqlite";
import { registerHuggingfaceLocalTasks } from "../bindings/registerTasks";
import { sleep } from "bun";
import { LOCAL_ONNX_TRANSFORMERJS } from "../model/ONNXTransformerJsModel";

describe("HFTransformersBinding", () => {
  describe("InMemoryJobQueue", () => {
    it("Should have an item queued", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
        LOCAL_ONNX_TRANSFORMERJS,
        new ConcurrencyLimiter(1, 10),
        AiProviderJob<TaskInput, TaskOutput>,
        10
      );
      queueRegistry.registerQueue(jobQueue);

      registerHuggingfaceLocalTasks();
      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel({
        name: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        url: "Xenova/LaMini-Flan-T5-783M",
        availableOnBrowser: true,
        availableOnServer: true,
        provider: LOCAL_ONNX_TRANSFORMERJS,
        pipeline: "text2text-generation",
      });
      await getGlobalModelRepository().connectTaskToModel(
        "TextGenerationTask",
        "onnx:Xenova/LaMini-Flan-T5-783M:q8"
      );
      await getGlobalModelRepository().connectTaskToModel(
        "TextRewritingTask",
        "onnx:Xenova/LaMini-Flan-T5-783M:q8"
      );

      const queue = queueRegistry.getQueue(LOCAL_ONNX_TRANSFORMERJS);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(LOCAL_ONNX_TRANSFORMERJS);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      });
      builder.run();
      await sleep(1);
      expect(await queue?.size()).toEqual(1);
      await queue?.clear();
    });
  });

  describe("SqliteJobQueue", () => {
    it("Should have an item queued", async () => {
      registerHuggingfaceLocalTasks();
      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel({
        name: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        url: "Xenova/LaMini-Flan-T5-783M",
        availableOnBrowser: true,
        availableOnServer: true,
        provider: LOCAL_ONNX_TRANSFORMERJS,
        pipeline: "text2text-generation",
      });
      await getGlobalModelRepository().connectTaskToModel(
        "TextGenerationTask",
        "onnx:Xenova/LaMini-Flan-T5-783M:q8"
      );
      await getGlobalModelRepository().connectTaskToModel(
        "TextRewritingTask",
        "onnx:Xenova/LaMini-Flan-T5-783M:q8"
      );
      const jobQueue = new SqliteJobQueue<TaskInput, TaskOutput>(
        getDatabase(":memory:"),
        LOCAL_ONNX_TRANSFORMERJS,
        new ConcurrencyLimiter(1, 10),
        AiProviderJob<TaskInput, TaskOutput>,
        10
      );
      jobQueue.ensureTableExists();
      getTaskQueueRegistry().registerQueue(jobQueue);
      const queue = getTaskQueueRegistry().getQueue(LOCAL_ONNX_TRANSFORMERJS);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(LOCAL_ONNX_TRANSFORMERJS);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      });
      builder.run();
      await sleep(1);
      expect(await queue?.size()).toEqual(1);
      builder.reset();
      await queue?.clear();
    });
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });
});

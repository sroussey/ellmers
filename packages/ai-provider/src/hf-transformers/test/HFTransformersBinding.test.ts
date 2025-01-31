//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { ConcurrencyLimiter, TaskGraphBuilder, TaskInput, TaskOutput } from "ellmers-core";
import {
  getProviderRegistry,
  getGlobalModelRepository,
  setGlobalModelRepository,
} from "ellmers-ai";
import { InMemoryJobQueue, InMemoryModelRepository } from "ellmers-storage/inmemory";
import { getDatabase, SqliteJobQueue } from "ellmers-storage/bun/sqlite";
import { registerHuggingfaceLocalTasks } from "../bindings/registerTasks";
import { sleep } from "bun";
import { LOCAL_ONNX_TRANSFORMERJS } from "../model/ONNXTransformerJsModel";

const HFQUEUE = "local_hf";

describe("HFTransformersBinding", () => {
  describe("InMemoryJobQueue", () => {
    it("Should have an item queued", async () => {
      const providerRegistry = getProviderRegistry();
      const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
        HFQUEUE,
        new ConcurrencyLimiter(1, 10),
        10
      );
      providerRegistry.registerQueue(LOCAL_ONNX_TRANSFORMERJS, jobQueue);

      registerHuggingfaceLocalTasks();
      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel({
        name: "ONNX Xenova/LaMini-Flan-T5-783M q8",
        url: "Xenova/LaMini-Flan-T5-783M",
        availableOnBrowser: true,
        availableOnServer: true,
        provider: LOCAL_ONNX_TRANSFORMERJS,
        pipeline: "text2text-generation",
      });
      await getGlobalModelRepository().connectTaskToModel(
        "TextGenerationTask",
        "ONNX Xenova/LaMini-Flan-T5-783M q8"
      );
      await getGlobalModelRepository().connectTaskToModel(
        "TextRewritingTask",
        "ONNX Xenova/LaMini-Flan-T5-783M q8"
      );

      const queue = providerRegistry.getQueue(LOCAL_ONNX_TRANSFORMERJS);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(HFQUEUE);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "ONNX Xenova/LaMini-Flan-T5-783M q8",
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
        name: "ONNX Xenova/LaMini-Flan-T5-783M q8",
        url: "Xenova/LaMini-Flan-T5-783M",
        availableOnBrowser: true,
        availableOnServer: true,
        provider: LOCAL_ONNX_TRANSFORMERJS,
        pipeline: "text2text-generation",
      });
      await getGlobalModelRepository().connectTaskToModel(
        "TextGenerationTask",
        "ONNX Xenova/LaMini-Flan-T5-783M q8"
      );
      await getGlobalModelRepository().connectTaskToModel(
        "TextRewritingTask",
        "ONNX Xenova/LaMini-Flan-T5-783M q8"
      );
      const providerRegistry = getProviderRegistry();
      const jobQueue = new SqliteJobQueue<TaskInput, TaskOutput>(
        getDatabase(":memory:"),
        HFQUEUE,
        new ConcurrencyLimiter(1, 10),
        10
      );
      jobQueue.ensureTableExists();
      providerRegistry.registerQueue(LOCAL_ONNX_TRANSFORMERJS, jobQueue);
      const queue = providerRegistry.getQueue(LOCAL_ONNX_TRANSFORMERJS);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(HFQUEUE);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "ONNX Xenova/LaMini-Flan-T5-783M q8",
      });
      builder.run();
      await sleep(1);
      expect(await queue?.size()).toEqual(1);
      builder.reset();
      await queue?.clear();
    });
  });
});

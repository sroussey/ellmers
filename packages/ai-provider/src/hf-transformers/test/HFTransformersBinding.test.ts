//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { ConcurrencyLimiter, TaskGraphBuilder, TaskInput, TaskOutput } from "ellmers-core";
import { getProviderRegistry, ModelProcessorEnum, ModelUseCaseEnum } from "ellmers-ai";
import { InMemoryJobQueue } from "ellmers-storage/inmemory";
import { SqliteJobQueue } from "ellmers-storage/bun/sqlite";
import { registerHuggingfaceLocalTasks } from "../bindings/registerTasks";
import { getDatabase } from "../../../../storage/src/util/db_sqlite";
import { sleep } from "bun";
import { ONNXTransformerJsModel } from "../model/ONNXTransformerJsModel";

const HFQUEUE = "local_hf";

describe("HFTransformersBinding", () => {
  describe("InMemoryJobQueue", () => {
    it("Should have an item queued", async () => {
      // the model gets self-registered
      const flanT5p786m = new ONNXTransformerJsModel(
        "Xenova/LaMini-Flan-T5-783M",
        [ModelUseCaseEnum.TEXT_GENERATION, ModelUseCaseEnum.TEXT_REWRITING],
        "text2text-generation"
      );
      registerHuggingfaceLocalTasks();
      const providerRegistry = getProviderRegistry();
      const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
        HFQUEUE,
        new ConcurrencyLimiter(1, 10),
        10
      );
      providerRegistry.registerQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS, jobQueue);
      const queue = providerRegistry.getQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(HFQUEUE);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "Xenova/LaMini-Flan-T5-783M",
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
      const providerRegistry = getProviderRegistry();
      const jobQueue = new SqliteJobQueue<TaskInput, TaskOutput>(
        getDatabase(),
        HFQUEUE,
        new ConcurrencyLimiter(1, 10),
        10
      );
      jobQueue.ensureTableExists();
      providerRegistry.registerQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS, jobQueue);
      const queue = providerRegistry.getQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(HFQUEUE);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "Xenova/LaMini-Flan-T5-783M",
      });
      builder.run();
      await sleep(1);
      expect(await queue?.size()).toEqual(1);
      builder.reset();
      await queue?.clear();
    });
  });
});

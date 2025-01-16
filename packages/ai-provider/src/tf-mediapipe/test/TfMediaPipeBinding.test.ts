//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { ConcurrencyLimiter, TaskGraphBuilder, TaskInput, TaskOutput } from "ellmers-core";
import { getProviderRegistry, ModelProviderEnum, ModelUseCaseEnum } from "ellmers-ai";
import { InMemoryJobQueue } from "ellmers-storage/inmemory";
import { SqliteJobQueue } from "ellmers-storage/bun/sqlite";
import { registerMediaPipeTfJsLocalTasks } from "../bindings/registerTasks";
import { sleep } from "ellmers-core";
import { MediaPipeTfJsModel } from "../model/MediaPipeModel";
import { getDatabase } from "../../../../storage/src/util/db_sqlite";

const TFQUEUE = "local_tf-mediapipe";

describe("TfMediaPipeBinding", () => {
  describe("InMemoryJobQueue", () => {
    it("should not fail", async () => {
      // register on creation
      const universal_sentence_encoder = new MediaPipeTfJsModel(
        "Universal Sentence Encoder",
        [ModelUseCaseEnum.TEXT_EMBEDDING],
        "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
        { dimensions: 100, browserOnly: true }
      );
      registerMediaPipeTfJsLocalTasks();
      const ProviderRegistry = getProviderRegistry();
      const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
        TFQUEUE,
        new ConcurrencyLimiter(1, 10),
        10
      );
      ProviderRegistry.registerQueue(ModelProviderEnum.MEDIA_PIPE_TFJS_MODEL, jobQueue);
      const queue = ProviderRegistry.getQueue(ModelProviderEnum.MEDIA_PIPE_TFJS_MODEL);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(TFQUEUE);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "Universal Sentence Encoder",
      });
      builder.run();
      await sleep(1);
      // we are not in a browser context, so the model should not be registered
      expect(await queue?.size()).toEqual(0);
      builder.reset();
      await queue?.clear();
    });
  });
  describe("SqliteJobQueue", () => {
    it("should not fail", async () => {
      const universal_sentence_encoder = new MediaPipeTfJsModel(
        "Universal Sentence Encoder",
        [ModelUseCaseEnum.TEXT_EMBEDDING],
        "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
        { dimensions: 100, browserOnly: true }
      );
      registerMediaPipeTfJsLocalTasks();
      const ProviderRegistry = getProviderRegistry();
      const jobQueue = new SqliteJobQueue<TaskInput, TaskOutput>(
        getDatabase(":memory:"),
        TFQUEUE,
        new ConcurrencyLimiter(1, 10),
        10
      );
      jobQueue.ensureTableExists();
      ProviderRegistry.registerQueue(ModelProviderEnum.MEDIA_PIPE_TFJS_MODEL, jobQueue);
      const queue = ProviderRegistry.getQueue(ModelProviderEnum.MEDIA_PIPE_TFJS_MODEL);
      expect(queue).toBeDefined();
      expect(queue?.queue).toEqual(TFQUEUE);

      const builder = new TaskGraphBuilder();
      builder.DownloadModel({
        model: "Universal Sentence Encoder",
      });
      builder.run();
      await sleep(1);
      // we are not in a browser context, so the model should not be registered
      expect(await queue?.size()).toEqual(0);
      builder.reset();
      await queue?.clear();
    });
  });
});

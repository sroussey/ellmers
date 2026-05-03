// /**
//  * @license
//  * Copyright 2025 Steven Roussey <sroussey@gmail.com>
//  * SPDX-License-Identifier: Apache-2.0
//  */

// import {
//   AiJob,
//   AiJobInput,
//   getGlobalModelRepository,
//   InMemoryModelRepository,
//   setGlobalModelRepository,
// } from "@workglow/ai";
// import {
//   TENSORFLOW_MEDIAPIPE,
//   TensorFlowMediaPipeProvider,
//   type TFMPModelRecord,
// } from "@workglow/ai-provider/tf-mediapipe";
// import { TFMP_TASKS } from "@workglow/ai-provider/tf-mediapipe";
// import {
//   ConcurrencyLimiter,
//   JobQueueClient,
//   JobQueueServer,
//   RateLimiter,
// } from "@workglow/job-queue";
// import { Sqlite } from "@workglow/sqlite/storage";
// import {
//   InMemoryQueueStorage,
//   SqliteQueueStorage,
//   SqliteRateLimiterStorage,
// } from "@workglow/storage";
// import {
//   getTaskQueueRegistry,
//   setTaskQueueRegistry,
//   TaskInput,
//   TaskOutput,
//   Workflow,
// } from "@workglow/task-graph";
// import { sleep } from "@workglow/util";
import { setLogger } from "@workglow/util";
import { describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

// const db = new Sqlite.Database(":memory:");

describe("TfMediaPipeBinding", async () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("should skip media pipe tests", () => {
    expect(true).toBe(true);
  });
  //   beforeEach(async () => {
  //     await setTaskQueueRegistry(null);
  //   });
  //   describe("InMemoryJobQueue", () => {
  //     it("should initialize without errors", async () => {
  //       const queueRegistry = getTaskQueueRegistry();
  //       const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
  //         TENSORFLOW_MEDIAPIPE
  //       );
  //       await storage.setupDatabase();
  //       const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
  //         AiJob<AiJobInput<TaskInput>, TaskOutput>,
  //         {
  //           storage,
  //           queueName: TENSORFLOW_MEDIAPIPE,
  //           limiter: new ConcurrencyLimiter(1, 10),
  //           pollIntervalMs: 1,
  //         }
  //       );
  //       const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
  //         storage,
  //         queueName: TENSORFLOW_MEDIAPIPE,
  //       });
  //       client.attach(server);
  //       await new TensorFlowMediaPipeProvider(TFMP_TASKS).register({
  //         mode: "inline",
  //         queue: { autoCreate: false },
  //       });
  //       queueRegistry.registerQueue({ server, client, storage });
  //       setGlobalModelRepository(new InMemoryModelRepository());
  //       const universal_sentence_encoder: TFMPModelRecord = {
  //         model_id: "media-pipe:Universal Sentence Encoder",
  //         title: "Universal Sentence Encoder",
  //         description: "Universal Sentence Encoder",
  //         tasks: ["TextEmbeddingTask"],
  //         provider: TENSORFLOW_MEDIAPIPE,
  //         provider_config: {
  //           model_path:
  //             "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
  //           pipeline: "text-embedder",
  //           task_engine: "text",
  //         },
  //         metadata: {},
  //       };
  //       await getGlobalModelRepository().addModel(universal_sentence_encoder);
  //       const registeredQueue = queueRegistry.getQueue(TENSORFLOW_MEDIAPIPE);
  //       expect(registeredQueue).toBeDefined();
  //       expect(registeredQueue?.server.queueName).toEqual(TENSORFLOW_MEDIAPIPE);
  //       const workflow = new Workflow();
  //       workflow.downloadModel({
  //         model: "media-pipe:Universal Sentence Encoder",
  //       });
  //       workflow.run();
  //       await sleep(1);
  //       expect(await registeredQueue?.client.size()).toEqual(1);
  //       workflow.reset();
  //       await registeredQueue?.storage.deleteAll();
  //     });
  //   });
  //   describe("SqliteJobQueue", () => {
  //     it("should not fail", async () => {
  //       setGlobalModelRepository(new InMemoryModelRepository());
  //       const universal_sentence_encoder: TFMPModelRecord = {
  //         model_id: "media-pipe:Universal Sentence Encoder",
  //         title: "Universal Sentence Encoder",
  //         description: "Universal Sentence Encoder",
  //         tasks: ["TextEmbeddingTask"],
  //         provider: TENSORFLOW_MEDIAPIPE,
  //         provider_config: {
  //           model_path:
  //             "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
  //           task_engine: "text",
  //           pipeline: "text-embedder",
  //         },
  //         metadata: {},
  //       };
  //       await getGlobalModelRepository().addModel(universal_sentence_encoder);
  //       const storage = new SqliteQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
  //         db,
  //         TENSORFLOW_MEDIAPIPE
  //       );
  //       await storage.setupDatabase();
  //       const limiterStorage = new SqliteRateLimiterStorage(db);
  //       await limiterStorage.setupDatabase();
  //       const limiter = new RateLimiter(limiterStorage, TENSORFLOW_MEDIAPIPE, {
  //         maxExecutions: 4,
  //         windowSizeInSeconds: 1,
  //       });
  //       const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
  //         AiJob<AiJobInput<TaskInput>, TaskOutput>,
  //         {
  //           storage,
  //           queueName: TENSORFLOW_MEDIAPIPE,
  //           limiter,
  //           pollIntervalMs: 1,
  //         }
  //       );
  //       const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
  //         storage,
  //         queueName: TENSORFLOW_MEDIAPIPE,
  //       });
  //       client.attach(server);
  //       await new TensorFlowMediaPipeProvider(TFMP_TASKS).register({
  //         mode: "inline",
  //         queue: { autoCreate: false },
  //       });
  //       getTaskQueueRegistry().registerQueue({ server, client, storage });
  //       const registeredQueue = getTaskQueueRegistry().getQueue(TENSORFLOW_MEDIAPIPE);
  //       expect(registeredQueue).toBeDefined();
  //       expect(registeredQueue?.server.queueName).toEqual(TENSORFLOW_MEDIAPIPE);
  //       const workflow = new Workflow();
  //       workflow.downloadModel({
  //         model: "media-pipe:Universal Sentence Encoder",
  //       });
  //       workflow.run();
  //       await sleep(1);
  //       expect(await registeredQueue?.client.size()).toEqual(1);
  //       workflow.reset();
  //       await registeredQueue?.storage.deleteAll();
  //     });
  //   });
  //   afterAll(async () => {
  //     await getTaskQueueRegistry().stopQueues();
  //     await getTaskQueueRegistry().clearQueues();
  //     await setTaskQueueRegistry(null);
  //   });
});

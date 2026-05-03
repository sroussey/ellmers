/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiJob,
  AiJobInput,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import type { HfTransformersOnnxModelRecord } from "@workglow/ai-provider/hf-transformers/runtime";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  HF_TRANSFORMERS_ONNX_CPU,
  registerHuggingFaceTransformersInline,
} from "@workglow/ai-provider/hf-transformers/runtime";
import {
  ConcurrencyLimiter,
  JobQueueClient,
  JobQueueServer,
  RateLimiter,
} from "@workglow/job-queue";
import { InMemoryQueueStorage, JobStatus } from "@workglow/job-queue";
import { SqliteQueueStorage, SqliteRateLimiterStorage } from "@workglow/storage";
import { Sqlite } from "@workglow/storage/sqlite";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskInput,
  TaskOutput,
  Workflow,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

await Sqlite.init();
const db = new Sqlite.Database(":memory:");

async function waitForQueueActivity(
  client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>
): Promise<number> {
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const [pending, processing, completed, failed, aborting, disabled] = await Promise.all([
      client.size(JobStatus.PENDING),
      client.size(JobStatus.PROCESSING),
      client.size(JobStatus.COMPLETED),
      client.size(JobStatus.FAILED),
      client.size(JobStatus.ABORTING),
      client.size(JobStatus.DISABLED),
    ]);
    total = pending + processing + completed + failed + aborting + disabled;
    if (total > 0) break;
    await sleep(10);
  }
  return total;
}

describe("HFTransformersBinding", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  // `setTaskQueueRegistry` is quick; 15s matches vitest and Bun CLI (`--timeout`) so hooks are not the tight limit
  beforeEach(async () => {
    await setTaskQueueRegistry(null);
  }, 15_000);

  describe("InMemoryJobQueue", () => {
    it("Should use the pre-registered queue", async () => {
      const queueRegistry = getTaskQueueRegistry();

      const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      await storage.setupDatabase();

      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
        AiJob<AiJobInput<TaskInput>, TaskOutput>,
        {
          storage,
          queueName: HF_TRANSFORMERS_ONNX_CPU,
          limiter: new ConcurrencyLimiter(1),
          pollIntervalMs: 1,
          stopTimeoutMs: 0,
        }
      );

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        storage,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
      });

      client.attach(server);
      // Register custom queue BEFORE the provider so QueuedExecutionStrategy.ensureQueue() finds it
      queueRegistry.registerQueue({ server, client, storage });
      clearPipelineCache();
      await registerHuggingFaceTransformersInline();

      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        title: "LaMini-Flan-T5-783M",
        description: "LaMini-Flan-T5-783M",
        tasks: ["TextGenerationTask", "TextRewriterTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text2text-generation",
          model_path: "Xenova/LaMini-Flan-T5-783M",
          dtype: "q8",
        },
        metadata: {},
      };

      setGlobalModelRepository(new InMemoryModelRepository());
      await getGlobalModelRepository().addModel(model);

      const registeredQueue = queueRegistry.getQueue<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      expect(registeredQueue).toBeDefined();
      expect(registeredQueue!.server.queueName).toEqual(HF_TRANSFORMERS_ONNX_CPU);

      const workflow = new Workflow();
      workflow.downloadModel({
        model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      });
      workflow.run().catch(() => {});
      // The provider should submit work to the pre-registered queue. Since
      // QueuedExecutionStrategy now starts an existing queue automatically,
      // the job may move from PENDING to PROCESSING/COMPLETED before we sample.
      const total = await waitForQueueActivity(registeredQueue!.client);
      expect(total).toBeGreaterThan(0);
      workflow.reset();
      await registeredQueue?.storage.deleteAll();
    }, 15_000);
  });

  describe("SqliteJobQueue", () => {
    it("Should use the pre-registered queue", async () => {
      const queueRegistry = getTaskQueueRegistry();
      const storage = new SqliteQueueStorage<AiJobInput<TaskInput>, TaskOutput>(db, "test");
      await storage.setupDatabase();
      const limiterStorage = new SqliteRateLimiterStorage(db);
      await limiterStorage.setupDatabase();
      const limiter = new RateLimiter(limiterStorage, "test", {
        maxExecutions: 4,
        windowSizeInSeconds: 1,
      });

      const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
        AiJob<AiJobInput<TaskInput>, TaskOutput>,
        {
          storage,
          queueName: HF_TRANSFORMERS_ONNX_CPU,
          limiter,
          pollIntervalMs: 1,
          stopTimeoutMs: 0,
        }
      );

      const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
        storage,
        queueName: HF_TRANSFORMERS_ONNX_CPU,
      });

      client.attach(server);
      // Register custom queue BEFORE the provider so QueuedExecutionStrategy.ensureQueue() finds it
      queueRegistry.registerQueue({ server, client, storage });

      clearPipelineCache();
      await registerHuggingFaceTransformersInline();

      setGlobalModelRepository(new InMemoryModelRepository());
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
        title: "LaMini-Flan-T5-783M",
        description: "LaMini-Flan-T5-783M",
        tasks: ["TextGenerationTask", "TextRewriterTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text2text-generation",
          model_path: "Xenova/LaMini-Flan-T5-783M",
          dtype: "q8",
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      const registeredQueue = queueRegistry.getQueue<AiJobInput<TaskInput>, TaskOutput>(
        HF_TRANSFORMERS_ONNX_CPU
      );
      expect(registeredQueue).toBeDefined();
      expect(registeredQueue?.server.queueName).toEqual(HF_TRANSFORMERS_ONNX_CPU);

      const workflow = new Workflow();
      workflow.downloadModel({
        model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      });
      workflow.run().catch(() => {});
      // The provider should submit work to the pre-registered queue. Since
      // QueuedExecutionStrategy now starts an existing queue automatically,
      // the job may move from PENDING to PROCESSING/COMPLETED before we sample.
      const total = await waitForQueueActivity(registeredQueue!.client);
      expect(total).toBeGreaterThan(0);
      workflow.reset();
      await registeredQueue?.storage.deleteAll();
    }, 15_000);
  });

  afterAll(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  }, 15_000);
});

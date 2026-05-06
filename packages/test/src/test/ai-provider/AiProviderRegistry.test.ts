/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiJob,
  AiJobInput,
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "@workglow/ai";
import { JobQueueClient, JobQueueServer, RateLimiter } from "@workglow/job-queue";
import { InMemoryQueueStorage, InMemoryRateLimiterStorage } from "@workglow/job-queue";
import type { IQueueStorage } from "@workglow/job-queue";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskInput,
  TaskOutput,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mock = vi.fn;

// Constants for testing
const TEST_PROVIDER = "test-provider";

describe("AiProviderRegistry", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let server: JobQueueServer<AiJobInput<TaskInput>, TaskOutput>;
  let client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>;
  let storage: IQueueStorage<AiJobInput<TaskInput>, TaskOutput>;
  let aiProviderRegistry: AiProviderRegistry;

  beforeEach(async () => {
    storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(TEST_PROVIDER);
    await storage.migrate();

    server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
      AiJob<AiJobInput<TaskInput>, TaskOutput>,
      {
        storage,
        queueName: TEST_PROVIDER,
        limiter: new RateLimiter(new InMemoryRateLimiterStorage(), TEST_PROVIDER, {
          maxExecutions: 4,
          windowSizeInSeconds: 1,
        }),
        pollIntervalMs: 1,
      }
    );

    client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      storage,
      queueName: TEST_PROVIDER,
    });

    client.attach(server);

    await setTaskQueueRegistry(new TaskQueueRegistry());
    const taskQueueRegistry = getTaskQueueRegistry();
    taskQueueRegistry.registerQueue({ server, client, storage });
    setAiProviderRegistry(new AiProviderRegistry()); // Ensure we're using the test registry
    aiProviderRegistry = getAiProviderRegistry();
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await storage.deleteAll();
  });

  afterAll(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  describe("registerRunFn", () => {
    test("should register a run function for a task type and model provider", () => {
      const mockRunFn = mock(() => Promise.resolve({ success: true }));
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, "text-generation", mockRunFn);

      expect(aiProviderRegistry.runFnRegistry.get("text-generation")?.get(TEST_PROVIDER)).toBe(
        mockRunFn
      );
    });

    test("should create task type object if it does not exist", () => {
      const mockRunFn = mock(() => Promise.resolve({ success: true }));
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, "new-task", mockRunFn);

      expect(aiProviderRegistry.runFnRegistry.get("new-task")).toBeDefined();
      expect(aiProviderRegistry.runFnRegistry.get("new-task")?.get(TEST_PROVIDER)).toBe(mockRunFn);
    });
  });

  describe("getDirectRunFn", () => {
    test("should return registered run function", () => {
      const mockRunFn = mock(() => Promise.resolve({ success: true }));
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, "text-generation", mockRunFn);

      const retrievedFn = aiProviderRegistry.getDirectRunFn(TEST_PROVIDER, "text-generation");
      expect(retrievedFn).toBe(mockRunFn);
    });

    test("should throw error for unregistered task type", () => {
      expect(() => {
        aiProviderRegistry.getDirectRunFn(TEST_PROVIDER, "nonexistent");
      }).toThrow('No run function found for task type "nonexistent" and provider "test-provider"');
    });
  });

  describe("jobAsTaskRunFn", () => {
    test("should create a job wrapper and queue it", async () => {
      const mockRunFn = mock(() => Promise.resolve({ result: "success" }));
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, "text-generation", mockRunFn);
      const wrappedFn = aiProviderRegistry.getDirectRunFn(TEST_PROVIDER, "text-generation");
      const result = await wrappedFn(
        { text: "test input" },
        undefined,
        () => {},
        new AbortController().signal
      );
      expect(result).toEqual({ result: "success" });
      expect(mockRunFn).toHaveBeenCalled();
    });
  });

  describe("singleton management", () => {
    test("should maintain a singleton instance", () => {
      const instance1 = getAiProviderRegistry();
      const instance2 = getAiProviderRegistry();
      expect(instance1).toBe(instance2);
    });

    test("should allow setting a new registry instance", () => {
      const newRegistry = new AiProviderRegistry();
      setAiProviderRegistry(newRegistry);
      expect(getAiProviderRegistry()).toBe(newRegistry);
    });
  });

  describe("AiJob", () => {
    test("should execute registered function with correct parameters", async () => {
      const mockRunFn = mock((...args) => {
        return Promise.resolve({ result: "success" });
      });

      aiProviderRegistry.registerRunFn(TEST_PROVIDER, "text-generation", mockRunFn);
      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test-model",
        tasks: ["text-generation"],
        provider: TEST_PROVIDER,
        provider_config: {
          pipeline: "text-generation",
          model_path: "test-model",
        },
        metadata: {},
      };

      const controller = new AbortController();
      const job = new AiJob({
        queueName: TEST_PROVIDER,
        input: {
          aiProvider: TEST_PROVIDER,
          taskType: "text-generation",
          taskInput: { text: "test", model },
        },
      });

      const result = await job.execute(job.input, {
        signal: controller.signal,
        updateProgress: async () => {},
      });

      expect(result).toEqual({ result: "success" });
    });
  });
});

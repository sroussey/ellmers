/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderStreamFn } from "@workglow/ai";
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
import type { StreamEvent } from "@workglow/task-graph";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskInput,
  TaskOutput,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mock = vi.fn;

const MOCK_PROVIDER = "mock-streaming-provider";

describe("Streaming Provider", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let server: JobQueueServer<AiJobInput<TaskInput>, TaskOutput>;
  let client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>;
  let storage: IQueueStorage<AiJobInput<TaskInput>, TaskOutput>;
  let registry: AiProviderRegistry;

  beforeEach(async () => {
    storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(MOCK_PROVIDER);
    await storage.setupDatabase();

    server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
      AiJob<AiJobInput<TaskInput>, TaskOutput>,
      {
        storage,
        queueName: MOCK_PROVIDER,
        limiter: new RateLimiter(new InMemoryRateLimiterStorage(), MOCK_PROVIDER, {
          maxExecutions: 4,
          windowSizeInSeconds: 1,
        }),
        pollIntervalMs: 1,
      }
    );

    client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      storage,
      queueName: MOCK_PROVIDER,
    });

    client.attach(server);

    await setTaskQueueRegistry(new TaskQueueRegistry());
    const taskQueueRegistry = getTaskQueueRegistry();
    taskQueueRegistry.registerQueue({ server, client, storage });
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
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

  describe("registerStreamFn", () => {
    it("should register a stream function for a task type and model provider", () => {
      const mockStreamFn: AiProviderStreamFn = async function* () {
        yield { type: "text-delta", port: "text", textDelta: "hello" };
        yield { type: "finish", data: { text: "hello" } };
      };

      registry.registerStreamFn(MOCK_PROVIDER, "TextGenerationTask", mockStreamFn);

      const retrieved = registry.getStreamFn(MOCK_PROVIDER, "TextGenerationTask");
      expect(retrieved).toBe(mockStreamFn);
    });

    it("should create task type map if it does not exist", () => {
      const mockStreamFn: AiProviderStreamFn = async function* () {
        yield { type: "finish", data: {} };
      };

      registry.registerStreamFn(MOCK_PROVIDER, "new-stream-task", mockStreamFn);

      expect(registry.streamFnRegistry.get("new-stream-task")).toBeDefined();
      expect(registry.streamFnRegistry.get("new-stream-task")?.get(MOCK_PROVIDER)).toBe(
        mockStreamFn
      );
    });
  });

  describe("getStreamFn", () => {
    it("should return undefined for unregistered stream function", () => {
      const result = registry.getStreamFn(MOCK_PROVIDER, "nonexistent");
      expect(result).toBeUndefined();
    });

    it("should return the registered stream function", () => {
      const mockStreamFn: AiProviderStreamFn = async function* () {
        yield { type: "finish", data: {} };
      };

      registry.registerStreamFn(MOCK_PROVIDER, "TextGenerationTask", mockStreamFn);
      const retrieved = registry.getStreamFn(MOCK_PROVIDER, "TextGenerationTask");
      expect(retrieved).toBe(mockStreamFn);
    });
  });

  describe("AiJob.executeStream", () => {
    it("should yield events from registered stream function", async () => {
      const mockStreamFn: AiProviderStreamFn = async function* (input, model, signal) {
        yield { type: "text-delta", port: "text", textDelta: "Hello" };
        yield { type: "text-delta", port: "text", textDelta: " " };
        yield { type: "text-delta", port: "text", textDelta: "world" };
        yield { type: "finish", data: { text: "Hello world" } };
      };

      registry.registerStreamFn(MOCK_PROVIDER, "TextGenerationTask", mockStreamFn);

      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test",
        tasks: ["TextGenerationTask"],
        provider: MOCK_PROVIDER,
        provider_config: {},
        metadata: {},
      };

      const jobInput: AiJobInput = {
        aiProvider: MOCK_PROVIDER,
        taskType: "TextGenerationTask",
        taskInput: { prompt: "test", model },
      };

      const job = new AiJob({
        queueName: MOCK_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent[] = [];

      for await (const event of job.executeStream(jobInput, {
        signal: controller.signal,
        updateProgress: async () => {},
      })) {
        events.push(event);
      }

      expect(events.length).toBe(4);
      expect(events[0]).toEqual({ type: "text-delta", port: "text", textDelta: "Hello" });
      expect(events[1]).toEqual({ type: "text-delta", port: "text", textDelta: " " });
      expect(events[2]).toEqual({ type: "text-delta", port: "text", textDelta: "world" });
      expect(events[3]).toEqual({ type: "finish", data: { text: "Hello world" } });
    });

    it("should fallback to non-streaming execute when no stream function registered", async () => {
      const mockRunFn = mock(() => Promise.resolve({ text: "non-streaming result" }));
      registry.registerRunFn(MOCK_PROVIDER, "TextGenerationTask", mockRunFn);
      // No stream function registered

      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test",
        tasks: ["TextGenerationTask"],
        provider: MOCK_PROVIDER,
        provider_config: {},
        metadata: {},
      };

      const jobInput: AiJobInput = {
        aiProvider: MOCK_PROVIDER,
        taskType: "TextGenerationTask",
        taskInput: { prompt: "test", model },
      };

      const job = new AiJob({
        queueName: MOCK_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent[] = [];

      for await (const event of job.executeStream(jobInput, {
        signal: controller.signal,
        updateProgress: async () => {},
      })) {
        events.push(event);
      }

      // Fallback: single finish event with the full result
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("finish");
      if (events[0].type === "finish") {
        expect(events[0].data).toEqual({ text: "non-streaming result" });
      }
    });

    it("should respect abort signal during streaming", async () => {
      const mockStreamFn: AiProviderStreamFn = async function* (input, model, signal) {
        yield { type: "text-delta", port: "text", textDelta: "Hello" };
        // Simulate slow streaming
        await sleep(200);
        if (signal.aborted) return;
        yield { type: "text-delta", port: "text", textDelta: " world" };
        yield { type: "finish", data: { text: "Hello world" } };
      };

      registry.registerStreamFn(MOCK_PROVIDER, "TextGenerationTask", mockStreamFn);

      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test",
        tasks: ["TextGenerationTask"],
        provider: MOCK_PROVIDER,
        provider_config: {},
        metadata: {},
      };

      const jobInput: AiJobInput = {
        aiProvider: MOCK_PROVIDER,
        taskType: "TextGenerationTask",
        taskInput: { prompt: "test", model },
      };

      const job = new AiJob({
        queueName: MOCK_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent[] = [];

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      for await (const event of job.executeStream(jobInput, {
        signal: controller.signal,
        updateProgress: async () => {},
      })) {
        events.push(event);
      }

      // Should have at least the first chunk, but possibly not all
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toEqual({ type: "text-delta", port: "text", textDelta: "Hello" });
    });
  });
});

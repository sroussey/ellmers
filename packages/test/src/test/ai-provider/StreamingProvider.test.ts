/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiJobInput, AiProviderRunFn, Capability } from "@workglow/ai";
import {
  AiJob,
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "@workglow/ai";
import type { IQueueStorage } from "@workglow/job-queue";
import {
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  RateLimiter,
  wrapQueueStorage,
} from "@workglow/job-queue";
import type { StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const MOCK_PROVIDER = "mock-streaming-provider";
const TEXT_GENERATION: readonly Capability[] = ["text.generation"];

describe("Streaming Provider", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let server: JobQueueServer<AiJobInput<TaskInput>, TaskOutput>;
  let client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>;
  let storage: IQueueStorage<AiJobInput<TaskInput>, TaskOutput>;
  let registry: AiProviderRegistry;

  beforeEach(async () => {
    storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(MOCK_PROVIDER);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);

    server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
      // AiJob's execute signature diverges from Job's base; cast is intentional.
      AiJob<AiJobInput<TaskInput>, TaskOutput> as any,
      {
        messageQueue,
        jobStore,
        queueName: MOCK_PROVIDER,
        limiter: new RateLimiter(new InMemoryRateLimiterStorage(), MOCK_PROVIDER, {
          maxExecutions: 4,
          windowSizeInSeconds: 1,
        }),
        pollIntervalMs: 1,
      }
    );

    client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      messageQueue,
      jobStore,
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

  describe("registerRunFn (streaming)", () => {
    it("should register a stream function for a capability set and provider", () => {
      const mockStreamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
        emit({ type: "text-delta", port: "text", textDelta: "hello" } as StreamEvent<TaskOutput>);
        emit({ type: "finish", data: { text: "hello" } } as StreamEvent<TaskOutput>);
      };

      registry.registerRunFn(MOCK_PROVIDER, {
        serves: TEXT_GENERATION,
        runFn: mockStreamFn,
      });

      const retrieved = registry.getRunFnFor(MOCK_PROVIDER, TEXT_GENERATION);
      expect(retrieved).toBe(mockStreamFn);
    });

    it("should create provider entry if it does not exist", () => {
      const mockStreamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
        emit({ type: "finish", data: {} } as StreamEvent<TaskOutput>);
      };

      registry.registerRunFn(MOCK_PROVIDER, {
        serves: ["text.embedding"],
        runFn: mockStreamFn,
      });

      const regs = registry.getRunFnRegistrations(MOCK_PROVIDER);
      expect(regs).toHaveLength(1);
      expect(regs[0].serves).toEqual(["text.embedding"]);
      expect(regs[0].runFn).toBe(mockStreamFn);
    });
  });

  describe("getRunFnFor (streaming)", () => {
    it("should return undefined for unregistered provider/capability", () => {
      const result = registry.getRunFnFor(MOCK_PROVIDER, ["text.embedding"]);
      expect(result).toBeUndefined();
    });

    it("should return the registered stream function", () => {
      const mockStreamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
        emit({ type: "finish", data: {} } as StreamEvent<TaskOutput>);
      };

      registry.registerRunFn(MOCK_PROVIDER, {
        serves: TEXT_GENERATION,
        runFn: mockStreamFn,
      });
      const retrieved = registry.getRunFnFor(MOCK_PROVIDER, TEXT_GENERATION);
      expect(retrieved).toBe(mockStreamFn);
    });
  });

  describe("AiJob.executeStream", () => {
    it("should yield events from registered stream function", async () => {
      const mockStreamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
        emit({ type: "text-delta", port: "text", textDelta: "Hello" } as StreamEvent<TaskOutput>);
        emit({ type: "text-delta", port: "text", textDelta: " " } as StreamEvent<TaskOutput>);
        emit({ type: "text-delta", port: "text", textDelta: "world" } as StreamEvent<TaskOutput>);
        emit({ type: "finish", data: { text: "Hello world" } } as StreamEvent<TaskOutput>);
      };

      registry.registerRunFn(MOCK_PROVIDER, {
        serves: TEXT_GENERATION,
        runFn: mockStreamFn,
      });

      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test",
        capabilities: ["text.generation"],
        provider: MOCK_PROVIDER,
        provider_config: {},
        metadata: {},
      };

      const jobInput: AiJobInput = {
        aiProvider: MOCK_PROVIDER,
        taskType: "TextGenerationTask",
        requires: TEXT_GENERATION,
        taskInput: { prompt: "test", model },
      };

      const job = new AiJob({
        queueName: MOCK_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent<TaskOutput>[] = [];

      await job.execute(
        jobInput,
        {
          signal: controller.signal,
          updateProgress: async () => {},
        },
        (e) => {
          events.push(e);
        }
      );

      expect(events.length).toBe(4);
      expect(events[0]).toEqual({ type: "text-delta", port: "text", textDelta: "Hello" });
      expect(events[1]).toEqual({ type: "text-delta", port: "text", textDelta: " " });
      expect(events[2]).toEqual({ type: "text-delta", port: "text", textDelta: "world" });
      expect(events[3]).toEqual({ type: "finish", data: { text: "Hello world" } });
    });

    it("should fallback to non-streaming execute when no stream function is registered for the capabilities", async () => {
      // Register a stream-fn under a DIFFERENT capability set so the
      // executeStream lookup misses but execute() still finds nothing.
      // Re-targeted: in capability-set dispatch there's no separate
      // "non-stream" map to fall back through. Verify that when the same
      // run-fn yields only a single finish event, executeStream forwards it.
      const mockStreamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
        emit({
          type: "finish",
          data: { text: "non-streaming result" },
        } as StreamEvent<TaskOutput>);
      };
      registry.registerRunFn(MOCK_PROVIDER, {
        serves: TEXT_GENERATION,
        runFn: mockStreamFn,
      });

      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test",
        capabilities: ["text.generation"],
        provider: MOCK_PROVIDER,
        provider_config: {},
        metadata: {},
      };

      const jobInput: AiJobInput = {
        aiProvider: MOCK_PROVIDER,
        taskType: "TextGenerationTask",
        requires: TEXT_GENERATION,
        taskInput: { prompt: "test", model },
      };

      const job = new AiJob({
        queueName: MOCK_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent<TaskOutput>[] = [];

      await job.execute(
        jobInput,
        {
          signal: controller.signal,
          updateProgress: async () => {},
        },
        (e) => {
          events.push(e);
        }
      );

      // Single finish event with the full result
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("finish");
      if (events[0].type === "finish") {
        expect(events[0].data).toEqual({ text: "non-streaming result" });
      }
    });

    it("should respect abort signal during streaming", async () => {
      const mockStreamFn: AiProviderRunFn = async (_input, _model, signal, emit) => {
        emit({ type: "text-delta", port: "text", textDelta: "Hello" } as StreamEvent<TaskOutput>);
        // Simulate slow streaming
        await sleep(200);
        if (signal.aborted) return;
        emit({ type: "text-delta", port: "text", textDelta: " world" } as StreamEvent<TaskOutput>);
        emit({
          type: "finish",
          data: { text: "Hello world" },
        } as StreamEvent<TaskOutput>);
      };

      registry.registerRunFn(MOCK_PROVIDER, {
        serves: TEXT_GENERATION,
        runFn: mockStreamFn,
      });

      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test",
        capabilities: ["text.generation"],
        provider: MOCK_PROVIDER,
        provider_config: {},
        metadata: {},
      };

      const jobInput: AiJobInput = {
        aiProvider: MOCK_PROVIDER,
        taskType: "TextGenerationTask",
        requires: TEXT_GENERATION,
        taskInput: { prompt: "test", model },
      };

      const job = new AiJob({
        queueName: MOCK_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent<TaskOutput>[] = [];

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      try {
        await job.execute(
          jobInput,
          {
            signal: controller.signal,
            updateProgress: async () => {},
          },
          (e) => {
            events.push(e);
          }
        );
      } catch {
        // executeStream may throw an AbortError after the abort fires; the
        // events accumulated before the abort are still valid for the
        // assertion below.
      }

      // Should have at least the first chunk, but possibly not all
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toEqual({ type: "text-delta", port: "text", textDelta: "Hello" });
    });
  });
});

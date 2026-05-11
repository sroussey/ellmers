/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFnRegistration,
  AiProviderStreamFn,
  Capability,
} from "@workglow/ai";
import {
  AiJob,
  AiJobInput,
  AiProviderRegistry,
  collectStream,
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
import type { StreamEvent } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

// Constants for testing
const TEST_PROVIDER = "test-provider";
const TEXT_GENERATION: readonly Capability[] = ["text.generation"];

/**
 * Build a one-shot streaming run-fn that resolves to `result` via a single
 * `finish` event. Records its inputs for assertions.
 */
function makeFinishStreamFn(
  result: TaskOutput,
  spy?: (...args: unknown[]) => void
): AiProviderStreamFn {
  return async function* (input, model, signal, outputSchema, sessionId) {
    spy?.(input, model, signal, outputSchema, sessionId);
    yield { type: "finish", data: result } as StreamEvent<TaskOutput>;
  };
}

function makeReg(
  serves: readonly Capability[],
  runFn: AiProviderStreamFn
): AiProviderRunFnRegistration {
  return { serves, runFn };
}

describe.skip("AiProviderRegistry", () => {
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
    test("should register a run function for a capability set and provider", () => {
      const runFn = makeFinishStreamFn({ success: true });
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, makeReg(TEXT_GENERATION, runFn));

      const retrieved = aiProviderRegistry.getRunFnFor(TEST_PROVIDER, TEXT_GENERATION);
      expect(retrieved).toBe(runFn);
    });

    test("should create provider entry if it does not exist", () => {
      const runFn = makeFinishStreamFn({ success: true });
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, makeReg(["text.embedding"], runFn));

      const regs = aiProviderRegistry.getRunFnRegistrations(TEST_PROVIDER);
      expect(regs).toHaveLength(1);
      expect(regs[0].serves).toEqual(["text.embedding"]);
      expect(regs[0].runFn).toBe(runFn);
    });
  });

  describe("getRunFnFor", () => {
    test("should return registered run function for matching capability set", () => {
      const runFn = makeFinishStreamFn({ success: true });
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, makeReg(TEXT_GENERATION, runFn));

      const retrieved = aiProviderRegistry.getRunFnFor(TEST_PROVIDER, TEXT_GENERATION);
      expect(retrieved).toBe(runFn);
    });

    test("should return undefined when no registration matches the requires set", () => {
      aiProviderRegistry.registerRunFn(
        TEST_PROVIDER,
        makeReg(["text.embedding"], makeFinishStreamFn({}))
      );

      const retrieved = aiProviderRegistry.getRunFnFor(TEST_PROVIDER, TEXT_GENERATION);
      expect(retrieved).toBeUndefined();
    });

    test("should return undefined for unregistered provider", () => {
      const retrieved = aiProviderRegistry.getRunFnFor("unknown-provider", TEXT_GENERATION);
      expect(retrieved).toBeUndefined();
    });
  });

  describe("capability-set dispatch", () => {
    test("collectStream returns finish.data for a registered one-shot run-fn", async () => {
      const runFn = makeFinishStreamFn({ result: "success" });
      aiProviderRegistry.registerRunFn(TEST_PROVIDER, makeReg(TEXT_GENERATION, runFn));
      const wrappedFn = aiProviderRegistry.getRunFnFor(TEST_PROVIDER, TEXT_GENERATION);
      expect(wrappedFn).toBeDefined();
      const result = await collectStream(
        wrappedFn!(
          { text: "test input" },
          undefined,
          new AbortController().signal,
          undefined,
          undefined
        )
      );
      expect(result).toEqual({ result: "success" });
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
      const spy = vi.fn();
      const runFn = makeFinishStreamFn({ result: "success" }, spy);

      aiProviderRegistry.registerRunFn(TEST_PROVIDER, makeReg(TEXT_GENERATION, runFn));
      const model = {
        model_id: "test:test-model:v1",
        title: "test-model",
        description: "test-model",
        capabilities: ["text.generation"],
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
          requires: TEXT_GENERATION,
          taskInput: { text: "test", model },
        },
      });

      const result = await job.execute(job.input, {
        signal: controller.signal,
        updateProgress: async () => {},
      });

      expect(result).toEqual({ result: "success" });
      expect(spy).toHaveBeenCalled();
    });
  });
});

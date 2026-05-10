/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRegisterContext,
  AiProviderRegisterOptions,
  AiProviderRunFn,
} from "@workglow/ai";
import {
  AiJob,
  AiProvider,
  AiProviderRegistry,
  getAiProviderRegistry,
  QueuedAiProvider,
  setAiProviderRegistry,
} from "@workglow/ai";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util/worker";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mock = vi.fn;

const TEST_PROVIDER_NAME = "test-ai-provider";

// A concrete test provider that accepts tasks via constructor (dependency injection)
class TestProvider extends AiProvider {
  readonly name = TEST_PROVIDER_NAME;
  readonly displayName = "Test AI Provider";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly taskTypes: readonly string[];

  public initializeCalled = false;
  public initializeOptions: AiProviderRegisterContext | null = null;
  public disposeCalled = false;

  constructor(fns?: Record<string, AiProviderRunFn<any, any, any>>) {
    super(fns);
    this.taskTypes = fns ? Object.keys(fns) : [];
  }

  protected override async onInitialize(options: AiProviderRegisterContext): Promise<void> {
    this.initializeCalled = true;
    this.initializeOptions = options;
  }

  override async dispose(): Promise<void> {
    this.disposeCalled = true;
  }
}

// A concrete test provider that auto-creates job queues (like the real providers)
class TestQueuedProvider extends QueuedAiProvider {
  readonly name = TEST_PROVIDER_NAME;
  readonly displayName = "Test AI Provider";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly taskTypes: readonly string[];

  constructor(fns?: Record<string, AiProviderRunFn<any, any, any>>) {
    super(fns);
    this.taskTypes = fns ? Object.keys(fns) : [];
  }
}

// A provider with static taskTypes (like the real providers)
class StaticTaskTypesProvider extends AiProvider {
  readonly name = "static-task-types-provider";
  readonly displayName = "Static Task Types";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly taskTypes = ["TextGenerationTask", "TextEmbeddingTask"] as const;

  constructor(fns?: Record<string, AiProviderRunFn<any, any, any>>) {
    super(fns);
  }
}

describe("AiProvider", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let aiProviderRegistry: AiProviderRegistry;

  beforeEach(async () => {
    await setTaskQueueRegistry(new TaskQueueRegistry());
    setAiProviderRegistry(new AiProviderRegistry());
    aiProviderRegistry = getAiProviderRegistry();
  });

  afterEach(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
  });

  afterAll(async () => {
    await setTaskQueueRegistry(null);
  });

  describe("supportedTaskTypes", () => {
    test("should return all task type names from taskTypes", () => {
      const mockRunFn = mock(() => Promise.resolve({ result: "ok" }));
      const provider = new TestProvider({
        TextGenerationTask: mockRunFn,
        TextEmbeddingTask: mockRunFn,
      });

      expect(provider.supportedTaskTypes).toEqual(["TextGenerationTask", "TextEmbeddingTask"]);
    });

    test("should return empty array for provider with no tasks", () => {
      const provider = new TestProvider({});
      expect(provider.supportedTaskTypes).toEqual([]);
    });

    test("should return static taskTypes even without tasks provided", () => {
      const provider = new StaticTaskTypesProvider();
      expect(provider.supportedTaskTypes).toEqual(["TextGenerationTask", "TextEmbeddingTask"]);
    });
  });

  describe("getRunFn", () => {
    test("should return the run function for a supported task type", () => {
      const mockRunFn = mock(() => Promise.resolve({ result: "ok" }));
      const provider = new TestProvider({
        TextGenerationTask: mockRunFn,
      });

      expect(provider.getRunFn("TextGenerationTask")).toBe(mockRunFn);
    });

    test("should return undefined for an unsupported task type", () => {
      const provider = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });

      expect(provider.getRunFn("NonExistentTask")).toBeUndefined();
    });

    test("should return undefined when no tasks provided", () => {
      const provider = new StaticTaskTypesProvider();
      expect(provider.getRunFn("TextGenerationTask")).toBeUndefined();
    });
  });

  describe("register (inline)", () => {
    test("should register all run functions with the AiProviderRegistry", async () => {
      const mockGenFn = mock(() => Promise.resolve({ text: "hello" }));
      const mockEmbedFn = mock(() => Promise.resolve({ vector: [] }));
      const provider = new TestProvider({
        TextGenerationTask: mockGenFn,
        TextEmbeddingTask: mockEmbedFn,
      });

      await provider.register({ queue: { autoCreate: false } });

      const genFn = aiProviderRegistry.getDirectRunFn(TEST_PROVIDER_NAME, "TextGenerationTask");
      expect(genFn).toBe(mockGenFn);

      const embedFn = aiProviderRegistry.getDirectRunFn(TEST_PROVIDER_NAME, "TextEmbeddingTask");
      expect(embedFn).toBe(mockEmbedFn);
    });

    test("should call onInitialize with the register options", async () => {
      const provider = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });

      const options: AiProviderRegisterOptions = { queue: { autoCreate: false } };
      await provider.register(options);

      expect(provider.initializeCalled).toBe(true);
      expect(provider.initializeOptions).toEqual({ ...options, isInline: true });
    });

    test("should register provider instance on the registry", async () => {
      const provider = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });

      await provider.register({ queue: { autoCreate: false } });

      const retrieved = aiProviderRegistry.getProvider(TEST_PROVIDER_NAME);
      expect(retrieved).toBe(provider);
    });

    test("should not auto-create a job queue (base AiProvider)", async () => {
      const provider = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({ text: "hello" })),
      });

      await provider.register();

      const registeredQueue = getTaskQueueRegistry().getQueue(TEST_PROVIDER_NAME);
      expect(registeredQueue).toBeUndefined();
    });

    test("should register a strategy resolver by default (QueuedAiProvider)", async () => {
      const provider = new TestQueuedProvider({
        TextGenerationTask: mock(() => Promise.resolve({ text: "hello" })),
      });

      await provider.register();

      // QueuedAiProvider registers a strategy resolver (queue is created lazily on first use)
      const strategy = aiProviderRegistry.getStrategy({
        provider: TEST_PROVIDER_NAME,
      } as any);
      expect(strategy).toBeDefined();
      expect(strategy).not.toBe((aiProviderRegistry as any).defaultStrategy);
    });

    test("should skip queue creation when autoCreate is false", async () => {
      const provider = new TestQueuedProvider({
        TextGenerationTask: mock(() => Promise.resolve({ text: "hello" })),
      });

      await provider.register({ queue: { autoCreate: false } });

      const registeredQueue = getTaskQueueRegistry().getQueue(TEST_PROVIDER_NAME);
      expect(registeredQueue).toBeUndefined();
    });
  });

  describe("register (worker)", () => {
    test("should throw when worker is omitted for worker-backed registration", async () => {
      const provider = new StaticTaskTypesProvider();
      await expect(provider.register({})).rejects.toThrow(/worker is required/);
    });

    test("should pass the configured worker idle timeout to WorkerManager", async () => {
      const provider = new StaticTaskTypesProvider();
      const workerFactory = () => ({}) as Worker;
      const originalWorkerManager = globalServiceRegistry.get(WORKER_MANAGER);
      const mockWorkerManager = {
        registerWorker: vi.fn(),
      };

      globalServiceRegistry.registerInstance(WORKER_MANAGER, mockWorkerManager as any);

      try {
        await provider.register({
          worker: workerFactory,
          workerIdleTimeoutMs: 1234,
        });
      } finally {
        globalServiceRegistry.registerInstance(WORKER_MANAGER, originalWorkerManager);
      }

      expect(mockWorkerManager.registerWorker).toHaveBeenCalledWith(
        "static-task-types-provider",
        workerFactory,
        { idleTimeoutMs: 1234 }
      );
    });

    test("should default factory-backed AI workers to a 15 minute idle timeout", async () => {
      const provider = new StaticTaskTypesProvider();
      const workerFactory = () => ({}) as Worker;
      const originalWorkerManager = globalServiceRegistry.get(WORKER_MANAGER);
      const mockWorkerManager = {
        registerWorker: vi.fn(),
      };

      globalServiceRegistry.registerInstance(WORKER_MANAGER, mockWorkerManager as any);

      try {
        await provider.register({
          worker: workerFactory,
        });
      } finally {
        globalServiceRegistry.registerInstance(WORKER_MANAGER, originalWorkerManager);
      }

      expect(mockWorkerManager.registerWorker).toHaveBeenCalledWith(
        "static-task-types-provider",
        workerFactory,
        { idleTimeoutMs: 15 * 60 * 1000 }
      );
    });
  });

  describe("registerOnWorkerServer", () => {
    test("should register all task functions on the worker server", () => {
      const mockGenFn = mock(() => Promise.resolve({ text: "hello" }));
      const mockEmbedFn = mock(() => Promise.resolve({ vector: [] }));
      const provider = new TestProvider({
        TextGenerationTask: mockGenFn,
        TextEmbeddingTask: mockEmbedFn,
      });

      const mockWorkerServer = {
        registerFunction: vi.fn(),
      };

      provider.registerOnWorkerServer(mockWorkerServer as any);

      expect(mockWorkerServer.registerFunction).toHaveBeenCalledTimes(2);
      expect(mockWorkerServer.registerFunction).toHaveBeenCalledWith(
        "TextGenerationTask",
        mockGenFn
      );
      expect(mockWorkerServer.registerFunction).toHaveBeenCalledWith(
        "TextEmbeddingTask",
        mockEmbedFn
      );
    });

    test("should throw when tasks not provided for worker server registration", () => {
      const provider = new StaticTaskTypesProvider();

      const mockWorkerServer = {
        registerFunction: vi.fn(),
      };

      expect(() => provider.registerOnWorkerServer(mockWorkerServer as any)).toThrow(
        /tasks must be provided via the constructor for worker server registration/
      );
    });
  });

  describe("dispose", () => {
    test("should call dispose on the provider", async () => {
      const provider = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });

      await provider.register({ queue: { autoCreate: false } });
      await provider.dispose();

      expect(provider.disposeCalled).toBe(true);
    });
  });

  describe("getProvider / getProviders", () => {
    test("should retrieve a registered provider by name", async () => {
      const provider = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });

      await provider.register({ queue: { autoCreate: false } });

      expect(aiProviderRegistry.getProvider(TEST_PROVIDER_NAME)).toBe(provider);
    });

    test("should return undefined for an unregistered provider", () => {
      expect(aiProviderRegistry.getProvider("nonexistent")).toBeUndefined();
    });

    test("should return all registered providers", async () => {
      const provider1 = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });
      const mockEmbedFn = mock(() => Promise.resolve({}));
      const provider2 = new StaticTaskTypesProvider({
        TextGenerationTask: mockEmbedFn,
        TextEmbeddingTask: mockEmbedFn,
      });

      aiProviderRegistry.registerProvider(provider1);
      aiProviderRegistry.registerProvider(provider2);

      const providers = aiProviderRegistry.getProviders();
      expect(providers.size).toBe(2);
      expect(providers.get(TEST_PROVIDER_NAME)).toBe(provider1);
      expect(providers.get("static-task-types-provider")).toBe(provider2);
    });

    test("getInstalledProviderIds returns sorted registered provider ids", async () => {
      expect(aiProviderRegistry.getInstalledProviderIds()).toEqual([]);

      const provider1 = new TestProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });
      const provider2 = new StaticTaskTypesProvider({
        TextGenerationTask: mock(() => Promise.resolve({})),
      });

      await provider1.register({ queue: { autoCreate: false } });
      await provider2.register({ queue: { autoCreate: false } });

      expect(aiProviderRegistry.getInstalledProviderIds()).toEqual([
        "static-task-types-provider",
        TEST_PROVIDER_NAME,
      ]);
    });

    test("getProviderIdsForTask returns empty when no run fns exist for task", () => {
      expect(aiProviderRegistry.getProviderIdsForTask("ModelSearchTask")).toEqual([]);
    });

    test("getProviderIdsForTask returns sorted provider ids with a run fn for that task", async () => {
      const mockRun = mock(() => Promise.resolve({}));
      const provider1 = new TestProvider({
        TextGenerationTask: mockRun,
      });
      const provider2 = new StaticTaskTypesProvider({
        TextGenerationTask: mockRun,
        TextEmbeddingTask: mockRun,
      });

      await provider1.register({ queue: { autoCreate: false } });
      await provider2.register({ queue: { autoCreate: false } });

      expect(aiProviderRegistry.getProviderIdsForTask("TextGenerationTask")).toEqual([
        "static-task-types-provider",
        TEST_PROVIDER_NAME,
      ]);
      expect(aiProviderRegistry.getProviderIdsForTask("TextEmbeddingTask")).toEqual([
        "static-task-types-provider",
      ]);
    });
  });

  describe("end-to-end: AiJob execution with provider", () => {
    test("should execute a job using a function registered via AiProvider", async () => {
      const mockRunFn = mock((_input: any, _model: any) => {
        return Promise.resolve({ text: "generated text" });
      });

      const provider = new TestProvider({
        TextGenerationTask: mockRunFn,
      });

      await provider.register({ queue: { autoCreate: false } });

      const model = {
        model_id: "test:model:v1",
        title: "test-model",
        description: "test model",
        capabilities: ["text.generation"],
        provider: TEST_PROVIDER_NAME,
        provider_config: { model_id: "test-model" },
        metadata: {},
      };

      const controller = new AbortController();
      const job = new AiJob({
        queueName: TEST_PROVIDER_NAME,
        input: {
          aiProvider: TEST_PROVIDER_NAME,
          taskType: "TextGenerationTask",
          taskInput: { prompt: "test prompt", model },
        },
      });

      const result = await job.execute(job.input, {
        signal: controller.signal,
        updateProgress: async () => {},
      });

      expect(result).toEqual({ text: "generated text" });
      expect(mockRunFn).toHaveBeenCalledOnce();
    });
  });
});

import { expect, test, describe, beforeEach, afterEach, afterAll, mock } from "bun:test";
import {
  AiProviderRegistry,
  AiProviderJob,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "../provider/AiProviderRegistry";
import {
  TaskInput,
  TaskOutput,
  TaskQueueRegistry,
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  sleep,
} from "ellmers-core";
import { InMemoryJobQueue } from "../../../storage/src/browser/inmemory/InMemoryJobQueue";
import { InMemoryRateLimiter } from "../../../storage/src/browser/inmemory/InMemoryRateLimiter";

// Constants for testing
const TEST_PROVIDER = "test-provider";

describe("AiProviderRegistry", () => {
  // Create a mock run function that reports progress
  const mockLongRunningRunFn = async (job: AiProviderJob, input: TaskInput) => {
    const jobQueue = job.queue!;
    await jobQueue.updateProgress(job.id, 25, "25% complete");
    await sleep(2);
    await jobQueue.updateProgress(job.id, 50, "50% complete");
    await sleep(2);
    await jobQueue.updateProgress(job.id, 75, "75% complete");
    await sleep(2);
    await jobQueue.updateProgress(job.id, 100, "100% complete");
    return { result: "success with progress" };
  };

  let queue = new InMemoryJobQueue(TEST_PROVIDER, new InMemoryRateLimiter(4, 1), AiProviderJob);
  let aiProviderRegistry: AiProviderRegistry;

  beforeEach(() => {
    queue = new InMemoryJobQueue(TEST_PROVIDER, new InMemoryRateLimiter(4, 1), AiProviderJob);
    setTaskQueueRegistry(new TaskQueueRegistry<TaskInput, TaskOutput>());
    const taskQueueRegistry = getTaskQueueRegistry();
    taskQueueRegistry.registerQueue(queue);
    setAiProviderRegistry(new AiProviderRegistry()); // Ensure we're using the test registry
    aiProviderRegistry = getAiProviderRegistry();
    queue.start(); // Clear the queue before each test
  });

  afterEach(async () => {
    await queue.stop();
    await queue.clear();
  });
  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });

  describe("registerRunFn", () => {
    test("should register a run function for a task type and model provider", () => {
      const mockRunFn = mock(() => Promise.resolve({ success: true }));
      aiProviderRegistry.registerRunFn("text-generation", TEST_PROVIDER, mockRunFn);

      expect(aiProviderRegistry.runFnRegistry["text-generation"][TEST_PROVIDER]).toBe(mockRunFn);
    });

    test("should create task type object if it does not exist", () => {
      const mockRunFn = mock(() => Promise.resolve({ success: true }));
      aiProviderRegistry.registerRunFn("new-task", TEST_PROVIDER, mockRunFn);

      expect(aiProviderRegistry.runFnRegistry["new-task"]).toBeDefined();
      expect(aiProviderRegistry.runFnRegistry["new-task"][TEST_PROVIDER]).toBe(mockRunFn);
    });
  });

  describe("getDirectRunFn", () => {
    test("should return registered run function", () => {
      const mockRunFn = mock(() => Promise.resolve({ success: true }));
      aiProviderRegistry.registerRunFn("text-generation", TEST_PROVIDER, mockRunFn);

      const retrievedFn = aiProviderRegistry.getDirectRunFn("text-generation", TEST_PROVIDER);
      expect(retrievedFn).toBe(mockRunFn);
    });

    test("should return undefined for unregistered task type", () => {
      const retrievedFn = aiProviderRegistry.getDirectRunFn("nonexistent", TEST_PROVIDER);
      expect(retrievedFn).toBeUndefined();
    });
  });

  describe("jobAsTaskRunFn", () => {
    test("should create a job wrapper and queue it", async () => {
      const mockRunFn = mock(() => Promise.resolve({ result: "success" }));
      aiProviderRegistry.registerRunFn("text-generation", TEST_PROVIDER, mockRunFn);

      // Create a mock task instance with a config that allows string assignments
      const mockTask = {
        config: {
          currentJobRunId: undefined as string | undefined,
          queue: undefined as string | undefined,
          currentJobId: undefined as string | undefined,
        },
      };

      const wrappedFn = aiProviderRegistry.toTaskRunFn("text-generation", TEST_PROVIDER);
      const result = await wrappedFn(mockTask as any, { text: "test input" });

      expect(result).toEqual({ result: "success" });
      expect(mockTask.config.queue).toBe(TEST_PROVIDER);
      expect(mockTask.config.currentJobId).toBeDefined();
      expect(mockRunFn).toHaveBeenCalled();
    });

    test("should handle progress updates in job execution", async () => {
      const progressUpdates: number[] = [];

      aiProviderRegistry.registerRunFn("text-generation", TEST_PROVIDER, mockLongRunningRunFn);

      // Create a mock task instance
      const mockTask = {
        config: {
          currentJobRunId: undefined as string | undefined,
          queue: undefined as string | undefined,
          currentJobId: undefined as string | undefined,
        },
      };

      // Subscribe to progress updates
      queue.on("job_progress", (queueName: string, jobId: unknown, progress: number) => {
        progressUpdates.push(progress);
      });

      const wrappedFn = aiProviderRegistry.toTaskRunFn("text-generation", TEST_PROVIDER);
      const result = await wrappedFn(mockTask as any, { text: "test input with progress" });

      // Give a small delay for all progress events to be processed
      await sleep(1);

      expect(result).toEqual({ result: "success with progress" });
      expect(progressUpdates).toEqual([25, 50, 75, 100]);
      expect(mockTask.config.queue).toBe(TEST_PROVIDER);
      expect(mockTask.config.currentJobId).toBeDefined();
    });

    test("should be able to get job progress using onJobProgress", async () => {
      aiProviderRegistry.registerRunFn("text-generation", TEST_PROVIDER, mockLongRunningRunFn);

      // Create a mock task instance
      const mockTask = {
        config: {
          currentJobRunId: undefined as string | undefined,
          queue: undefined as string | undefined,
          currentJobId: undefined as string | undefined,
        },
      };

      const wrappedFn = aiProviderRegistry.toTaskRunFn("text-generation", TEST_PROVIDER);

      // Start the function but don't await it yet
      const resultPromise = wrappedFn(mockTask as any, { text: "test input with progress" });

      // Wait a bit for the job to be created and ID to be set
      await sleep(1);

      // Track progress using onJobProgress
      const progressUpdates: number[] = [];
      const cleanup = queue.onJobProgress(mockTask.config.currentJobId, (progress, message) => {
        progressUpdates.push(progress);
      });

      const result = await resultPromise;
      cleanup(); // Remove the progress listener

      // Give a small delay for any final progress updates
      await sleep(1);

      expect(result).toEqual({ result: "success with progress" });
      expect(progressUpdates).toEqual([25, 50, 75, 100]);
      expect(mockTask.config.queue).toBe(TEST_PROVIDER);
      expect(mockTask.config.currentJobId).toBeDefined();
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

  describe("AiProviderJob", () => {
    test("should execute registered function with correct parameters", async () => {
      const mockRunFn = mock(() => Promise.resolve({ result: "success" }));
      aiProviderRegistry.registerRunFn("text-generation", TEST_PROVIDER, mockRunFn);

      const job = new AiProviderJob({
        queueName: TEST_PROVIDER,
        input: {
          taskType: "text-generation",
          modelProvider: TEST_PROVIDER,
          taskInput: { text: "test" },
        },
      });

      const result = await job.execute();

      expect(mockRunFn).toHaveBeenCalledWith(job, { text: "test" }, undefined);
      expect(result).toEqual({ result: "success" });
    });
  });
});

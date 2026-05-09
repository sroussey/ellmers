/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiJob,
  AiProvider,
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "@workglow/ai";
import type { AiJobInput, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { ModelConfig, ToolCallingTaskInput, ToolDefinition } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import { makeFingerprint, setLogger } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mock = vi.fn;

const TEST_PROVIDER = "session-test-provider";

describe("SessionCaching", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let registry: AiProviderRegistry;

  beforeEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
  });

  afterEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
  });

  describe("AiProviderRunFn sessionId parameter", () => {
    it("should receive sessionId as the last parameter when provided", async () => {
      let capturedSessionId: string | undefined;

      const runFn: AiProviderRunFn = mock(
        async (input, model, updateProgress, signal, outputSchema, sessionId) => {
          capturedSessionId = sessionId;
          return { result: "ok" };
        }
      );

      registry.registerRunFn(TEST_PROVIDER, "text-generation", runFn);

      const fn = registry.getDirectRunFn(TEST_PROVIDER, "text-generation");
      await fn(
        { text: "hello" },
        undefined,
        () => {},
        new AbortController().signal,
        undefined,
        "session-abc-123"
      );

      expect(capturedSessionId).toBe("session-abc-123");
      expect(runFn).toHaveBeenCalledWith(
        { text: "hello" },
        undefined,
        expect.any(Function),
        expect.any(AbortSignal),
        undefined,
        "session-abc-123"
      );
    });

    it("should receive undefined sessionId when not provided", async () => {
      let capturedSessionId: string | undefined = "should-be-overwritten";

      const runFn: AiProviderRunFn = mock(
        async (input, model, updateProgress, signal, outputSchema, sessionId) => {
          capturedSessionId = sessionId;
          return { result: "ok" };
        }
      );

      registry.registerRunFn(TEST_PROVIDER, "text-generation", runFn);

      const fn = registry.getDirectRunFn(TEST_PROVIDER, "text-generation");
      await fn({ text: "hello" }, undefined, () => {}, new AbortController().signal);

      expect(capturedSessionId).toBeUndefined();
    });
  });

  describe("AiProviderStreamFn sessionId parameter", () => {
    it("should receive sessionId as the last parameter when provided", async () => {
      let capturedSessionId: string | undefined;

      const streamFn: AiProviderStreamFn = async function* (
        input,
        model,
        signal,
        outputSchema,
        sessionId
      ) {
        capturedSessionId = sessionId;
        yield { type: "finish", data: { result: "streamed" } } as StreamEvent<TaskOutput>;
      };

      registry.registerStreamFn(TEST_PROVIDER, "text-generation", streamFn);

      const fn = registry.getStreamFn(TEST_PROVIDER, "text-generation")!;
      expect(fn).toBeDefined();

      const events: StreamEvent<TaskOutput>[] = [];
      for await (const event of fn(
        { text: "hello" },
        undefined,
        new AbortController().signal,
        undefined,
        "session-stream-456"
      )) {
        events.push(event);
      }

      expect(capturedSessionId).toBe("session-stream-456");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("finish");
    });

    it("should receive undefined sessionId when not provided", async () => {
      let capturedSessionId: string | undefined = "should-be-overwritten";

      const streamFn: AiProviderStreamFn = async function* (
        input,
        model,
        signal,
        outputSchema,
        sessionId
      ) {
        capturedSessionId = sessionId;
        yield { type: "finish", data: {} } as StreamEvent<TaskOutput>;
      };

      registry.registerStreamFn(TEST_PROVIDER, "text-generation", streamFn);

      const fn = registry.getStreamFn(TEST_PROVIDER, "text-generation")!;
      for await (const _event of fn({ text: "hello" }, undefined, new AbortController().signal)) {
        // consume events
      }

      expect(capturedSessionId).toBeUndefined();
    });
  });

  describe("AiJob sessionId threading", () => {
    it("should pass sessionId from AiJobInput to the run function", async () => {
      let capturedSessionId: string | undefined;

      const runFn: AiProviderRunFn = mock(
        async (input, model, updateProgress, signal, outputSchema, sessionId) => {
          capturedSessionId = sessionId;
          return { result: "from-job" };
        }
      );

      registry.registerRunFn(TEST_PROVIDER, "text-generation", runFn);

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

      const jobInput: AiJobInput<TaskInput> = {
        aiProvider: TEST_PROVIDER,
        taskType: "text-generation",
        taskInput: { text: "test", model },
        sessionId: "job-session-789",
      };

      const job = new AiJob({
        queueName: TEST_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const result = await job.execute(job.input, {
        signal: controller.signal,
        updateProgress: async () => {},
      });

      expect(result).toEqual({ result: "from-job" });
      expect(capturedSessionId).toBe("job-session-789");
    });

    it("should pass sessionId from AiJobInput to the stream function", async () => {
      let capturedSessionId: string | undefined;

      const streamFn: AiProviderStreamFn = async function* (
        input,
        model,
        signal,
        outputSchema,
        sessionId
      ) {
        capturedSessionId = sessionId;
        yield { type: "text-delta", data: { text: "hello" } } as unknown as StreamEvent<TaskOutput>;
        yield { type: "finish", data: {} as TaskOutput } as StreamEvent<TaskOutput>;
      };

      registry.registerStreamFn(TEST_PROVIDER, "text-generation", streamFn);

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

      const jobInput: AiJobInput<TaskInput> = {
        aiProvider: TEST_PROVIDER,
        taskType: "text-generation",
        taskInput: { text: "test", model },
        sessionId: "stream-job-session-101",
      };

      const job = new AiJob({
        queueName: TEST_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      const events: StreamEvent<TaskOutput>[] = [];
      for await (const event of job.executeStream(job.input, {
        signal: controller.signal,
        updateProgress: async () => {},
      })) {
        events.push(event);
      }

      expect(capturedSessionId).toBe("stream-job-session-101");
      expect(events).toHaveLength(2);
    });

    it("should pass undefined sessionId when not set in AiJobInput", async () => {
      let capturedSessionId: string | undefined = "should-be-overwritten";

      const runFn: AiProviderRunFn = mock(
        async (input, model, updateProgress, signal, outputSchema, sessionId) => {
          capturedSessionId = sessionId;
          return { result: "ok" };
        }
      );

      registry.registerRunFn(TEST_PROVIDER, "text-generation", runFn);

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

      const jobInput: AiJobInput<TaskInput> = {
        aiProvider: TEST_PROVIDER,
        taskType: "text-generation",
        taskInput: { text: "test", model },
        // no sessionId
      };

      const job = new AiJob({
        queueName: TEST_PROVIDER,
        input: jobInput,
      });

      const controller = new AbortController();
      await job.execute(job.input, {
        signal: controller.signal,
        updateProgress: async () => {},
      });

      expect(capturedSessionId).toBeUndefined();
    });
  });

  describe("AiProvider.createSession / disposeSession", () => {
    class TestProvider extends AiProvider {
      readonly name = "TEST_SESSION_PROVIDER";
      readonly displayName = "Test";
      readonly isLocal = true;
      readonly supportsBrowser = true;
      readonly taskTypes = ["TestTask"] as const;
    }

    it("createSession returns a UUID string", () => {
      const provider = new TestProvider();
      const sessionId = provider.createSession({} as ModelConfig);
      expect(typeof sessionId).toBe("string");
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("createSession returns unique IDs on each call", () => {
      const provider = new TestProvider();
      const id1 = provider.createSession({} as ModelConfig);
      const id2 = provider.createSession({} as ModelConfig);
      expect(id1).not.toBe(id2);
    });

    it("disposeSession does not throw", async () => {
      const provider = new TestProvider();
      await expect(provider.disposeSession("any-session-id")).resolves.toBeUndefined();
    });
  });

  describe("AiProviderRegistry.createSession / disposeSession", () => {
    class TestProvider extends AiProvider {
      readonly name = "REGISTRY_SESSION_PROVIDER";
      readonly displayName = "Test";
      readonly isLocal = true;
      readonly supportsBrowser = true;
      readonly taskTypes = ["TestTask"] as const;
    }

    it("createSession delegates to the registered provider", () => {
      const provider = new TestProvider();
      const customId = "custom-session-id-from-provider";
      provider.createSession = vi.fn().mockReturnValue(customId);
      registry.registerProvider(provider);

      const model = { provider: "REGISTRY_SESSION_PROVIDER" } as ModelConfig;
      const sessionId = registry.createSession("REGISTRY_SESSION_PROVIDER", model);

      expect(sessionId).toBe(customId);
      expect(provider.createSession).toHaveBeenCalledWith(model);
    });

    it("createSession throws for unknown provider", () => {
      expect(() => registry.createSession("UNKNOWN_PROVIDER", {} as ModelConfig)).toThrow(
        /No provider found for "UNKNOWN_PROVIDER"/
      );
    });

    it("disposeSession delegates to registered provider without throwing", async () => {
      const provider = new TestProvider();
      provider.disposeSession = vi.fn().mockResolvedValue(undefined);
      registry.registerProvider(provider);

      await expect(
        registry.disposeSession("REGISTRY_SESSION_PROVIDER", "session-to-dispose")
      ).resolves.toBeUndefined();
      expect(provider.disposeSession).toHaveBeenCalledWith("session-to-dispose");
    });

    it("disposeSession is silent for unknown provider", async () => {
      await expect(
        registry.disposeSession("NONEXISTENT_PROVIDER", "session-xyz")
      ).resolves.toBeUndefined();
    });
  });
});

describe("Session caching: sessionId on task input", () => {
  it("ToolCallingTaskInput accepts optional sessionId", () => {
    const input: ToolCallingTaskInput = {
      model: "test-model",
      prompt: "hello",
      tools: [] as ToolDefinition[],
      messages: undefined,
      sessionId: "test-session",
    };
    expect(input.sessionId).toBe("test-session");
  });

  it("ToolCallingTaskInput works without sessionId", () => {
    const input: ToolCallingTaskInput = {
      model: "test-model",
      prompt: "hello",
      tools: [] as ToolDefinition[],
      messages: undefined,
    };
    expect(input.sessionId).toBeUndefined();
  });
});

describe("Session caching: session ID computation", () => {
  it("prefix-rewind hash is deterministic for same tools + systemPrompt", async () => {
    const tools = [
      { name: "tool_a", description: "A", inputSchema: { type: "object" } },
      { name: "tool_b", description: "B", inputSchema: { type: "object" } },
    ];
    const systemPrompt = "You are a helpful assistant.";

    const hash1 = await makeFingerprint({ tools, systemPrompt });
    const hash2 = await makeFingerprint({ tools, systemPrompt });

    expect(hash1).toBe(hash2);
  });

  it("prefix-rewind hash changes when tools change", async () => {
    const tools1 = [{ name: "tool_a", description: "A", inputSchema: { type: "object" } }];
    const tools2 = [{ name: "tool_b", description: "B", inputSchema: { type: "object" } }];
    const systemPrompt = "You are a helpful assistant.";

    const hash1 = await makeFingerprint({ tools: tools1, systemPrompt });
    const hash2 = await makeFingerprint({ tools: tools2, systemPrompt });

    expect(hash1).not.toBe(hash2);
  });

  it("prefix-rewind hash changes when systemPrompt changes", async () => {
    const tools = [{ name: "tool_a", description: "A", inputSchema: { type: "object" } }];

    const hash1 = await makeFingerprint({ tools, systemPrompt: "prompt A" });
    const hash2 = await makeFingerprint({ tools, systemPrompt: "prompt B" });

    expect(hash1).not.toBe(hash2);
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiJobInput, AiProviderRunFn } from "@workglow/ai";
import {
  AiJob,
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
  TextSummaryTask,
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
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { ResourceScope, setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { report, snap } from "../../binding/testTiming";

const MOCK_PROVIDER = "mock-phase-provider";

describe("StreamingAiTask default phase emissions", () => {
  let server: JobQueueServer<AiJobInput<TaskInput>, TaskOutput>;
  let client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>;
  let storage: IQueueStorage<AiJobInput<TaskInput>, TaskOutput>;
  let registry: AiProviderRegistry;
  let resourceScope: ResourceScope;

  beforeAll(() => {
    resourceScope = new ResourceScope();
  });

  beforeEach(async () => {
    const logger = getTestingLogger();
    setLogger(logger);

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
          maxExecutions: 10,
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
    getTaskQueueRegistry().registerQueue({ server, client, storage });
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await storage.deleteAll();
  });

  afterAll(async () => {
    const s = snap();
    await resourceScope.disposeAll();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
    report("StreamingAiTaskPhases dispose", s);
  });

  const buildModel = (taskType: string) => ({
    model_id: `${MOCK_PROVIDER}:test-model:v1`,
    title: "test-model",
    description: "test",
    capabilities: [taskType],
    provider: MOCK_PROVIDER,
    provider_config: {},
    metadata: {},
  });

  it("emits 'Preparing' before any data event", async () => {
    const s = snap();
    const streamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "text-delta", port: "text", textDelta: "hi" });
      emit({ type: "finish", data: {} });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["text.summary"], runFn: streamFn });

    const model = buildModel("text.summary");
    const task = new TextSummaryTask({ id: "p1" });
    const messages: Array<string | undefined> = [];
    task.subscribe("progress", (_progress, message) => messages.push(message));
    await task.run({ model: model as any, text: "test" }, { resourceScope });

    const idxPreparing = messages.indexOf("Preparing");
    const idxLabel = messages.indexOf("Summarizing");
    expect(
      idxPreparing,
      `expected 'Preparing' in messages ${JSON.stringify(messages)}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      idxLabel,
      `expected 'Summarizing' after 'Preparing' in messages ${JSON.stringify(messages)}`
    ).toBeGreaterThan(idxPreparing);
    report("phase: preparing", s);
  });

  it("uses the subclass's streamingPhaseLabel on first data event", async () => {
    const s = snap();
    const streamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "text-delta", port: "text", textDelta: "hi" });
      emit({ type: "finish", data: {} });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["text.summary"], runFn: streamFn });

    const model = buildModel("text.summary");
    const task = new TextSummaryTask({ id: "p2" });
    const events: Array<{ progress: number | undefined; message: string | undefined }> = [];
    task.subscribe("progress", (progress, message) => events.push({ progress, message }));
    await task.run({ model: model as any, text: "test" }, { resourceScope });

    expect(events).toContainEqual({ progress: undefined, message: "Summarizing" });
    report("phase: subclass label", s);
  });

  it("provider-yielded phase overrides the default", async () => {
    const s = snap();
    const streamFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "phase", message: "Calling Anthropic", progress: undefined });
      emit({ type: "text-delta", port: "text", textDelta: "hi" });
      emit({ type: "finish", data: {} });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["text.summary"], runFn: streamFn });

    const model = buildModel("text.summary");
    const task = new TextSummaryTask({ id: "p3" });
    const messages: Array<string | undefined> = [];
    task.subscribe("progress", (_progress, message) => messages.push(message));
    await task.run({ model: model as any, text: "test" }, { resourceScope });

    const idxPreparing = messages.indexOf("Preparing");
    const idxCalling = messages.indexOf("Calling Anthropic");
    const idxLabel = messages.indexOf("Summarizing");
    expect(
      idxPreparing,
      `expected 'Preparing' in messages ${JSON.stringify(messages)}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      idxCalling,
      `expected 'Calling Anthropic' after 'Preparing' in messages ${JSON.stringify(messages)}`
    ).toBeGreaterThan(idxPreparing);
    expect(
      idxLabel,
      `expected 'Summarizing' after 'Calling Anthropic' in messages ${JSON.stringify(messages)}`
    ).toBeGreaterThan(idxCalling);
    report("phase: provider override", s);
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiJob,
  AiJobInput,
  AiProviderRegistry,
  getAiProviderRegistry,
  setAiProviderRegistry,
  TextSummaryTask,
} from "@workglow/ai";
import type { AiProviderStreamFn } from "@workglow/ai";
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
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const MOCK_PROVIDER = "mock-phase-provider";

describe("StreamingAiTask default phase emissions", () => {
  let server: JobQueueServer<AiJobInput<TaskInput>, TaskOutput>;
  let client: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>;
  let storage: IQueueStorage<AiJobInput<TaskInput>, TaskOutput>;
  let registry: AiProviderRegistry;

  beforeEach(async () => {
    const logger = getTestingLogger();
    setLogger(logger);

    storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(MOCK_PROVIDER);
    await storage.migrate();

    server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(
      AiJob<AiJobInput<TaskInput>, TaskOutput>,
      {
        storage,
        queueName: MOCK_PROVIDER,
        limiter: new RateLimiter(new InMemoryRateLimiterStorage(), MOCK_PROVIDER, {
          maxExecutions: 10,
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
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  const buildModel = (taskType: string) => ({
    model_id: `${MOCK_PROVIDER}:test-model:v1`,
    title: "test-model",
    description: "test",
    tasks: [taskType],
    provider: MOCK_PROVIDER,
    provider_config: {},
    metadata: {},
  });

  it("emits 'Preparing' before any data event", async () => {
    const streamFn: AiProviderStreamFn = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "hi" };
      yield { type: "finish", data: {} };
    };
    registry.registerStreamFn(MOCK_PROVIDER, "TextSummaryTask", streamFn);

    const model = buildModel("TextSummaryTask");
    const task = new TextSummaryTask({ id: "p1" });
    const messages: Array<string | undefined> = [];
    task.subscribe("progress", (_progress, message) => messages.push(message));
    await task.run({ model: model as any, text: "test" });

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
  });

  it("uses the subclass's streamingPhaseLabel on first data event", async () => {
    const streamFn: AiProviderStreamFn = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "hi" };
      yield { type: "finish", data: {} };
    };
    registry.registerStreamFn(MOCK_PROVIDER, "TextSummaryTask", streamFn);

    const model = buildModel("TextSummaryTask");
    const task = new TextSummaryTask({ id: "p2" });
    const events: Array<{ progress: number | undefined; message: string | undefined }> = [];
    task.subscribe("progress", (progress, message) => events.push({ progress, message }));
    await task.run({ model: model as any, text: "test" });

    expect(events).toContainEqual({ progress: undefined, message: "Summarizing" });
  });

  it("provider-yielded phase overrides the default", async () => {
    const streamFn: AiProviderStreamFn = async function* () {
      yield { type: "phase", message: "Calling Anthropic", progress: undefined };
      yield { type: "text-delta", port: "text", textDelta: "hi" };
      yield { type: "finish", data: {} };
    };
    registry.registerStreamFn(MOCK_PROVIDER, "TextSummaryTask", streamFn);

    const model = buildModel("TextSummaryTask");
    const task = new TextSummaryTask({ id: "p3" });
    const messages: Array<string | undefined> = [];
    task.subscribe("progress", (_progress, message) => messages.push(message));
    await task.run({ model: model as any, text: "test" });

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
  });
});

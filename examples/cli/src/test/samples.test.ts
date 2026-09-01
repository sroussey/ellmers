/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import { InMemoryTabularStorage } from "@workglow/storage";
import type { Task } from "@workglow/task-graph";
import {
  computeGraphInputSchema,
  createGraphFromGraphJSON,
  registerBaseTasks,
  TaskGraph,
  TaskGraphPrimaryKeyNames,
  TaskGraphSchema,
  TaskGraphTabularRepository,
} from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildChatSampleGraph,
  CHAT_SAMPLE_ID,
  ensureChatSample,
  seedSamplesIfRepoEmpty,
} from "../samples/chatSample";

beforeAll(() => {
  registerBaseTasks();
  registerCommonTasks({ fileSystemTasks: true });
  registerAiTasks();
});

function mkRepo(): TaskGraphTabularRepository {
  return new TaskGraphTabularRepository({
    tabularRepository: new InMemoryTabularStorage(TaskGraphSchema, TaskGraphPrimaryKeyNames),
  });
}

describe("chatSample", () => {
  it("builds a graph with exactly one AiChatTask", () => {
    const graph = buildChatSampleGraph();
    const tasks = graph.getTasks();
    expect(tasks.length).toBe(1);
    expect((tasks[0].constructor as typeof Task).type).toBe("AiChatTask");
  });

  it("pre-populates the model default with Bonsai ONNX q1", () => {
    const graph = buildChatSampleGraph();
    const tasks = graph.getTasks();
    const defaults = tasks[0].defaults;
    expect(defaults.model).toMatchObject({
      provider: "HF_TRANSFORMERS_ONNX",
      provider_config: {
        model_path: "onnx-community/Bonsai-1.7B-ONNX",
        dtype: "q1",
        pipeline: "text-generation",
      },
    });
  });

  it("surfaces prompt as required in computeGraphInputSchema", () => {
    const graph = buildChatSampleGraph();
    const schema = computeGraphInputSchema(graph) as any;
    expect(schema.required).toContain("prompt");
  });

  it("round-trips through JSON", () => {
    const graph = buildChatSampleGraph();
    const json = graph.toJSON();
    const restored = createGraphFromGraphJSON(json);
    expect(restored.getTasks().length).toBe(1);
    const task = restored.getTasks()[0];
    expect((task.constructor as typeof Task).type).toBe("AiChatTask");
    const defaults = task.defaults;
    expect(defaults.model).toMatchObject({
      provider: "HF_TRANSFORMERS_ONNX",
      provider_config: {
        model_path: "onnx-community/Bonsai-1.7B-ONNX",
      },
    });
  });
});

describe("ensureChatSample", () => {
  it("installs the sample on a clean repo", async () => {
    const repo = mkRepo();
    await repo.setupDatabase();
    await ensureChatSample(repo);
    const row = await repo.tabularRepository.get({ key: CHAT_SAMPLE_ID });
    expect(row).toBeDefined();
  });

  it("is idempotent — running twice leaves one copy", async () => {
    const repo = mkRepo();
    await repo.setupDatabase();
    await ensureChatSample(repo);
    await ensureChatSample(repo);
    const all = await repo.tabularRepository.getAll();
    expect(all?.filter((e: { key?: string }) => e.key === CHAT_SAMPLE_ID).length).toBe(1);
  });
});

describe("seedSamplesIfRepoEmpty", () => {
  it("seeds when the repo is empty", async () => {
    const repo = mkRepo();
    await repo.setupDatabase();
    await seedSamplesIfRepoEmpty(repo);
    const row = await repo.tabularRepository.get({ key: CHAT_SAMPLE_ID });
    expect(row).toBeDefined();
  });

  it("does NOT re-seed when the repo has any workflow (even if chat is missing)", async () => {
    const repo = mkRepo();
    await repo.setupDatabase();
    // Simulate a user's non-chat workflow
    const other = new TaskGraph();
    await repo.saveTaskGraph("other", other);

    await seedSamplesIfRepoEmpty(repo);
    const chat = await repo.tabularRepository.get({ key: CHAT_SAMPLE_ID });
    expect(chat).toBeUndefined();
  });
});

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraphRepository } from "@workglow/task-graph";
import {
  Dataflow,
  TaskGraph,
  TaskGraphTabularRepository,
  TaskRegistry,
} from "@workglow/task-graph";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TestIOTask } from "../task/TestTasks";

export function runGenericTaskGraphRepositoryTests(
  createRepository: () => Promise<TaskGraphRepository>
) {
  let repository: TaskGraphRepository;

  beforeEach(async () => {
    TaskRegistry.all.clear();
    repository = await createRepository();
    await (repository as any).setupDatabase?.();
  });

  afterEach(async () => {
    await repository.clear();
  });

  it("should initialize the tabularRepository", () => {
    if (repository instanceof TaskGraphTabularRepository) {
      expect(repository.tabularRepository).toBeDefined();
    }
  });

  it("should fail if the task is not registered", async () => {
    const id: string = "g0";
    const graph = new TaskGraph();
    const tasks = [new TestIOTask({ id: "task1" })];
    graph.addTasks(tasks);
    await repository.saveTaskGraph(id, graph);
    await expect(repository.getTaskGraph(id)).rejects.toThrow();
  });

  it("should store and retrieve task graph", async () => {
    TaskRegistry.registerTask(TestIOTask);
    const id: string = "g1";
    const graph = new TaskGraph();
    const tasks = [
      new TestIOTask({ id: "task1" }),
      new TestIOTask({ id: "task2" }),
      new TestIOTask({ id: "task3" }),
    ];
    const edges: Dataflow[] = [
      new Dataflow("task1", "output1", "task2", "input1"),
      new Dataflow("task2", "output2", "task3", "input2"),
    ];

    graph.addTasks(tasks);
    graph.addDataflows(edges);

    expect(graph.getDataflow("task1[output1] ==> task2[input1]")).toBeDefined();
    expect(graph.getDataflow("task2[output2] ==> task3[input2]")).toBeDefined();

    await repository.saveTaskGraph(id, graph);

    const retrievedGraph = await repository.getTaskGraph(id);

    expect(retrievedGraph?.toJSON()).toEqual(graph?.toJSON());
  });

  it("should return undefined for non-existent task graph", async () => {
    const id: string = "g2";

    const retrievedGraph = await repository.getTaskGraph(id);

    expect(retrievedGraph).toBeUndefined();
  });
}

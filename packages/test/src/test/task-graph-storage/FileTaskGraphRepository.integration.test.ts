/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataflow, TaskGraph, TaskRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { rmSync } from "fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FsFolderTaskGraphRepository } from "../../binding/FsFolderTaskGraphRepository";
import { TestIOTask } from "../task/TestTasks";

TaskRegistry.registerTask(TestIOTask);

describe("FsFolderTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let repository: FsFolderTaskGraphRepository;

  beforeEach(() => {
    try {
      rmSync(".cache/test/file-task-graph", { recursive: true });
    } catch {}
    repository = new FsFolderTaskGraphRepository(".cache/test/file-task-graph");
  });

  it("should initialize the tabularRepository", () => {
    expect(repository.tabularRepository).toBeDefined();
  });

  it("should store and retrieve task graph", async () => {
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
});

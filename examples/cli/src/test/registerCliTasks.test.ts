/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGraphFromGraphJSON, TaskGraph, TaskRegistry } from "@workglow/task-graph";
import { FileGrepTask, FileLoaderTask, FileSedTask } from "@workglow/tasks";
import { beforeAll, describe, expect, it } from "vitest";
import { registerCliTasks } from "../registerCliTasks";

beforeAll(() => registerCliTasks());

/**
 * These names are the CLI's published surface, not an implementation detail:
 * `workglow task run <type>` takes one, and every workflow the repository holds
 * stores one per node. A type that stops being registered stops resolving, and
 * a stored graph that names it stops loading — with nothing at the call site to
 * say so. The list is therefore pinned here rather than left to whatever the
 * task packages happen to register.
 */
describe("the CLI's task surface", () => {
  it("registers the filesystem tasks", () => {
    expect(TaskRegistry.all.get(FileLoaderTask.type)).toBe(FileLoaderTask);
    expect(TaskRegistry.all.get(FileGrepTask.type)).toBe(FileGrepTask);
    expect(TaskRegistry.all.get(FileSedTask.type)).toBe(FileSedTask);
  });

  it("registers the utility and base tasks the commands are built on", () => {
    for (const type of [
      "InputTask",
      "OutputTask",
      "LambdaTask",
      "JsonTask",
      "FetchUrlTask",
      "MergeTask",
      "DelayTask",
    ]) {
      expect(TaskRegistry.all.has(type)).toBe(true);
    }
  });

  /**
   * The failure this guards is a stored workflow, not a fresh graph: the JSON
   * on disk names `FileLoaderTask` as a string and nothing else, so an
   * unregistered type surfaces as a workflow that no longer opens.
   */
  it("loads a saved graph that names a filesystem task", () => {
    const graph = new TaskGraph();
    graph.addTask(new FileLoaderTask({ id: "load", defaults: { url: "notes.txt" } } as any));

    const rebuilt = createGraphFromGraphJSON(graph.toJSON());

    expect(rebuilt.getTask("load")).toBeInstanceOf(FileLoaderTask);
  });
});

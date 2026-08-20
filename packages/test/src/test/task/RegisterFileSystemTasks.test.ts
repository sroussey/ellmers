/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import {
  FileGrepTask,
  FileLoaderTask,
  FileSedTask,
  registerCommonTasks,
  registerFileSystemTasks,
} from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const FILE_SYSTEM_TASK_TYPES = [FileGrepTask.type, FileLoaderTask.type, FileSedTask.type];

/**
 * `TaskRegistry` is how a DESERIALIZED graph names a task, and a serialized
 * node carries its own `config` — so a hostile graph naming `FileGrepTask`
 * also supplies its own `roots`, and no default the package picks constrains
 * it. Registration is therefore the boundary: a host that has not asked for
 * the filesystem tasks must not be able to have one built by type name.
 */
describe("filesystem task registration is opt-in", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  function unregisterAll(): void {
    for (const type of FILE_SYSTEM_TASK_TYPES) TaskRegistry.unregisterTask(type);
  }

  beforeEach(unregisterAll);
  afterEach(unregisterAll);

  test("registerCommonTasks leaves the filesystem tasks out of the registry", () => {
    registerCommonTasks();

    for (const type of FILE_SYSTEM_TASK_TYPES) {
      expect(TaskRegistry.all.has(type)).toBe(false);
    }
  });

  test("registerCommonTasks does not return the filesystem tasks either", () => {
    const returned = registerCommonTasks().map((task) => task.type);

    for (const type of FILE_SYSTEM_TASK_TYPES) {
      expect(returned).not.toContain(type);
    }
  });

  test("registerFileSystemTasks puts all three in the registry", () => {
    registerFileSystemTasks();

    expect(TaskRegistry.all.get(FileGrepTask.type)).toBe(FileGrepTask);
    expect(TaskRegistry.all.get(FileLoaderTask.type)).toBe(FileLoaderTask);
    expect(TaskRegistry.all.get(FileSedTask.type)).toBe(FileSedTask);
  });

  test("registerFileSystemTasks returns the three it registered", () => {
    expect(registerFileSystemTasks().map((task) => task.type)).toEqual(FILE_SYSTEM_TASK_TYPES);
  });

  /**
   * The classes stay exported and constructible — only ambient registry
   * availability moved. An embedder that builds one in its own code is
   * unaffected by the split.
   */
  test("the classes are still exported and constructible without registering", () => {
    expect(() => new FileGrepTask({ defaults: { url: "x", pattern: "y" } })).not.toThrow();
    expect(() => new FileLoaderTask({ defaults: { url: "x" } })).not.toThrow();
    expect(
      () => new FileSedTask({ defaults: { url: "x", pattern: "y", replacement: "z" } })
    ).not.toThrow();
  });
});

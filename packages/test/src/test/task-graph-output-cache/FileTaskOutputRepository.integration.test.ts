/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FsFolderTaskOutputRepository } from "../../binding/FsFolderTaskOutputRepository";

describe("FsFolderTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let repository: FsFolderTaskOutputRepository;

  beforeEach(() => {
    try {
      rmSync(".cache/test/file-task-output", { recursive: true });
    } catch {}
    repository = new FsFolderTaskOutputRepository(".cache/test/file-task-output");
  });

  it("should initialize the output storage", () => {
    expect(repository.storage).toBeDefined();
  });

  it("should store and retrieve task outputs", async () => {
    const input: TaskInput = { id: "task1" };
    const output: TaskOutput = { result: "success" };
    const taskType: string = "taskType1";

    await repository.saveOutput(taskType, input, output);
    const retrievedOutput = await repository.getOutput(taskType, input);

    expect(retrievedOutput).toEqual(output);
  });

  it("should return undefined for non-existent task outputs", async () => {
    const input: TaskInput = { id: "task2" };
    const taskType: string = "taskType1";

    const retrievedOutput = await repository.getOutput(taskType, input);

    expect(retrievedOutput).toBeUndefined();
  });
});

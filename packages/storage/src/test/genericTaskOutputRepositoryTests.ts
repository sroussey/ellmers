//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach } from "bun:test";
import { TaskInput, TaskOutput, TaskOutputRepository } from "ellmers-core";

export function runGenericTaskOutputRepositoryTests(
  createRepository: () => Promise<TaskOutputRepository>,
  repositoryName: string
) {
  describe(`TaskOutputRepository Tests - ${repositoryName}`, () => {
    let repository: TaskOutputRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    it("should initialize the kvRepository", () => {
      expect(repository.kvRepository).toBeDefined();
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
}

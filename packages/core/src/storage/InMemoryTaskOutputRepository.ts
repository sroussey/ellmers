//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "task";
import { ITaskOutputRepository } from "./ITaskOutputRepository";
import { makeFingerprint } from "../util/Misc";

export class InMemoryTaskOutputRepository implements ITaskOutputRepository {
  outputs = new Map<string, TaskOutput>();

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const inputsHash = await makeFingerprint(inputs);
    const id = `${taskType}_${inputsHash}`;
    this.outputs.set(id, output);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const inputsHash = await makeFingerprint(inputs);
    const id = `${taskType}_${inputsHash}`;
    const out = this.outputs.get(id);
    return out;
  }
}

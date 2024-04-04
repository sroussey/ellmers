//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "task";
import { TaskOutputRepository } from "./TaskOutputRepository";
import { makeFingerprint } from "../util/Misc";

export class InMemoryTaskOutputRepository extends TaskOutputRepository {
  outputs = new Map<string, TaskOutput>();

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const inputsHash = await makeFingerprint(inputs);
    const id = `${taskType}_${inputsHash}`;
    this.outputs.set(id, output);
    this.emit("output_saved", taskType);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const inputsHash = await makeFingerprint(inputs);
    const id = `${taskType}_${inputsHash}`;
    const out = this.outputs.get(id);
    this.emit("output_retrieved", taskType);
    return out;
  }

  async clear(): Promise<void> {
    this.outputs.clear();
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return this.outputs.size;
  }
}

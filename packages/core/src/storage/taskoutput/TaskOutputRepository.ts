//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { TaskInput, TaskOutput } from "../../task/base/Task";
import { KVRepository } from "../base/KVRepository";

export type TaskOutputEvents = "output_saved" | "output_retrieved" | "output_cleared";

export const TaskOutputDiscriminator = {
  taskType: "string",
} as const;

export abstract class TaskOutputRepository {
  public type = "TaskOutputRepository";
  abstract kvRepository: KVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;
  private events = new EventEmitter<TaskOutputEvents>();
  on(name: TaskOutputEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }
  off(name: TaskOutputEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }
  emit(name: TaskOutputEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
  }

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    await this.kvRepository.put({ taskType, inputs }, output);
    this.emit("output_saved", taskType);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const output = await this.kvRepository.get({ taskType, inputs });
    this.emit("output_retrieved", taskType);
    return output as TaskOutput;
  }

  async clear(): Promise<void> {
    await this.kvRepository.clear();
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return await this.kvRepository.size();
  }
}

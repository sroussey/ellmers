//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { TaskInput, TaskOutput } from "../../task/base/Task";
import { DefaultValueType, KVRepository } from "../base/KVRepository";
import { makeFingerprint } from "../../util/Misc";

export type TaskOutputEvents = "output_saved" | "output_retrieved" | "output_cleared";

export type TaskOutputPrimaryKey = {
  key: string;
  taskType: string;
};
export const TaskOutputPrimaryKeySchema = {
  key: "string",
  taskType: "string",
} as const;

export abstract class TaskOutputRepository {
  public type = "TaskOutputRepository";
  abstract kvRepository: KVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
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
    const key = await makeFingerprint(inputs);
    const value = JSON.stringify(output);
    await this.kvRepository.putKeyValue({ key, taskType }, { "kv-value": value });
    this.emit("output_saved", taskType);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const key = await makeFingerprint(inputs);
    const output = await this.kvRepository.getKeyValue({ key, taskType });
    this.emit("output_retrieved", taskType);
    return output ? (JSON.parse(output["kv-value"]) as TaskOutput) : undefined;
  }

  async clear(): Promise<void> {
    await this.kvRepository.deleteAll();
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    return await this.kvRepository.size();
  }
}

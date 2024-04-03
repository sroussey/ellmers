//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { TaskInput, TaskOutput } from "task";

export type TaskOutputEvents = "output_saved" | "output_retrieved" | "output_cleared";

export interface ITaskOutputRepository {
  saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void>;
  getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined>;
  clear(): Promise<void>;
  size(): Promise<number>;
  on(event: TaskOutputEvents, listener: (event: TaskOutputEvents, taskType: string) => void): void;
}

export abstract class TaskOutputRepository implements ITaskOutputRepository {
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

  abstract saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void>;
  abstract getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined>;
  abstract clear(): Promise<void>;
  abstract size(): Promise<number>;
}

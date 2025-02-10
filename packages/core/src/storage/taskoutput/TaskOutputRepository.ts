//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { TaskInput, TaskOutput } from "../../task/base/Task";
import { DefaultValueType, IKVRepository } from "../base/IKVRepository";
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

/**
 * Abstract class for managing task outputs in a repository
 * Provides methods for saving, retrieving, and clearing task outputs
 */
export abstract class TaskOutputRepository {
  public type = "TaskOutputRepository";
  abstract kvRepository: IKVRepository<TaskOutputPrimaryKey, DefaultValueType>;
  private events = new EventEmitter<TaskOutputEvents>();

  /**
   * Registers an event listener for a specific event
   * @param name The event name to listen for
   * @param fn The callback function to execute when the event occurs
   */
  on(name: TaskOutputEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }

  /**
   * Removes an event listener for a specific event
   * @param name The event name to stop listening for
   * @param fn The callback function to remove
   */
  off(name: TaskOutputEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }

  /**
   * Emits an event with the given arguments
   * @param name The event name to emit
   * @param args Additional arguments to pass to the event listeners
   */
  emit(name: TaskOutputEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
  }

  /**
   * Saves a task output to the repository
   * @param taskType The type of task to save the output for
   * @param inputs The input parameters for the task
   * @param output The task output to save
   */
  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const key = await makeFingerprint(inputs);
    const value = JSON.stringify(output);
    await this.kvRepository.putKeyValue({ key, taskType }, { value: value });
    this.emit("output_saved", taskType);
  }

  /**
   * Retrieves a task output from the repository
   * @param taskType The type of task to retrieve the output for
   * @param inputs The input parameters for the task
   * @returns The retrieved task output, or undefined if not found
   */
  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const key = await makeFingerprint(inputs);
    const output = await this.kvRepository.getKeyValue({ key, taskType });
    this.emit("output_retrieved", taskType);
    return output ? (JSON.parse(output["value"]) as TaskOutput) : undefined;
  }

  /**
   * Clears all task outputs from the repository
   * @emits output_cleared when the operation completes
   */
  async clear(): Promise<void> {
    await this.kvRepository.deleteAll();
    this.emit("output_cleared");
  }

  /**
   * Returns the number of task outputs stored in the repository
   * @returns The count of stored task outputs
   */
  async size(): Promise<number> {
    return await this.kvRepository.size();
  }
}

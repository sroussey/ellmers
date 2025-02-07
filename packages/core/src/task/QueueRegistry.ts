//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { JobQueue } from "../job/base/JobQueue";
import { TaskInput, TaskOutput } from "./base/Task";

let taskQueueRegistry: TaskQueueRegistry<TaskInput, TaskOutput> | null = null;

export class TaskQueueRegistry<Input, Output> {
  public queues: Map<string, JobQueue<Input, Output>> = new Map();
  /**
   * Queue management methods for starting, stopping, and clearing job queues
   * These methods help control the execution flow of tasks across all providers
   */
  registerQueue(jobQueue: JobQueue<Input, Output>) {
    this.queues.set(jobQueue.queue, jobQueue);
  }

  getQueue(queue: string) {
    return this.queues.get(queue);
  }

  startQueues() {
    for (const queue of this.queues.values()) {
      queue.start();
    }
  }

  stopQueues() {
    for (const queue of this.queues.values()) {
      queue.stop();
    }
  }

  clearQueues() {
    for (const queue of this.queues.values()) {
      queue.clear();
    }
  }
}

export function getTaskQueueRegistry() {
  if (!taskQueueRegistry) {
    taskQueueRegistry = new TaskQueueRegistry<TaskInput, TaskOutput>();
  }
  return taskQueueRegistry;
}

export function setTaskQueueRegistry(registry: TaskQueueRegistry<TaskInput, TaskOutput>) {
  taskQueueRegistry = registry;
}

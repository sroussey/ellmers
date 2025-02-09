//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { getTaskQueueRegistry } from "../TaskQueueRegistry";
import { SingleTask, TaskConfig, TaskOutput } from "./Task";

/**
 * Configuration interface for job queue tasks
 */
export interface JobQueueTaskConfig extends TaskConfig {
  queue?: string;
  currentJobId?: unknown;
  currentJobRunId?: string;
}

/**
 * Configuration interface for job queue tasks with ids
 */
interface JobQueueTaskWithIdsConfig extends JobQueueTaskConfig {
  id: unknown;
}

/**
 * Base class for job queue tasks
 */
export abstract class JobQueueTask extends SingleTask {
  static readonly type: string = "JobQueueTask";
  declare config: JobQueueTaskWithIdsConfig;
  constructor(config: JobQueueTaskConfig) {
    super(config);
  }

  async run(): Promise<TaskOutput> {
    if (!this.validateInputData(this.runInputData)) {
      throw new Error("Invalid input data");
    }
    this.emit("start");
    this.runOutputData = {};

    try {
      const job = await this.createJob();

      const queue = getTaskQueueRegistry().getQueue(this.config.queue!);
      if (!queue) {
        throw new Error("Queue not found");
      }

      const jobId = await queue.add(job);
      this.config.currentJobRunId = job.jobRunId; // no longer undefined
      this.config.currentJobId = jobId;

      const cleanup = queue.onJobProgress(jobId, (progress, message, details) => {
        this.emit("progress", progress, message, details);
      });
      this.runOutputData = await queue.waitFor(jobId);
      cleanup();
    } catch (err) {
      this.emit("error", err instanceof Error ? err.message : String(err));
      console.error(err);
      throw err;
    }
    this.runOutputData ??= {};
    this.runOutputData = await this.runReactive();
    this.emit("complete");
    return this.runOutputData;
  }

  /**
   * Override this method to create the right job class for the queue for this task
   * @returns Promise<Job> - The created job
   */
  async createJob() {
    const queue = getTaskQueueRegistry().getQueue(this.config.queue!);
    if (!queue) {
      throw new Error("Queue not found");
    }
    const job = new queue.jobClass({
      queueName: queue.queue,
      jobRunId: this.config.currentJobRunId, // could be undefined
      input: this.runInputData,
    });
    return job;
  }

  /**
   * Aborts the task
   * @returns A promise that resolves when the task is aborted
   */
  async abort(): Promise<void> {
    if (this.config.queue) {
      const queue = getTaskQueueRegistry().getQueue(this.config.queue);
      if (queue) {
        queue.abort(this.config.currentJobId);
      }
    }
    super.abort();
  }
}

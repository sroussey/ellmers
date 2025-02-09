//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  TaskInput,
  TaskOutput,
  JobQueue,
  JobQueueTask,
  Job,
  JobQueueTaskConfig,
  sleep,
} from "ellmers-core";
import { TaskGraphRepository } from "ellmers-core";

export class TestJob extends Job<TaskInput, TaskOutput> {
  async execute(signal: AbortSignal): Promise<TaskOutput> {
    return this.input.a + this.input.b;
  }
}

export class TestJobTask extends JobQueueTask {
  static readonly type: string = "TestJobTask";
  private jobQueue: JobQueue<TaskInput, TaskOutput>;
  constructor(config: JobQueueTaskConfig & { jobQueue: JobQueue<TaskInput, TaskOutput> }) {
    const { jobQueue, ...rest } = config;
    super(rest);
    this.jobQueue = jobQueue;
  }
  async run(): Promise<TaskOutput> {
    if (!this.validateInputData(this.runInputData)) {
      throw new Error("Invalid input data");
    }
    this.emit("start");
    this.runOutputData = {};
    const job = new TestJob({
      input: this.runInputData,
    });
    const jobId = await this.jobQueue.add(job);
    this.config.queue = this.jobQueue.queue;
    this.config.currentJobRunId = job.jobRunId; // no longer undefined
    this.config.currentJobId = jobId;

    const result = await this.jobQueue.waitFor(jobId);
    this.runOutputData = { result };
    this.emit("complete");
    return this.runOutputData;
  }
}

export function runGenericTaskGraphJobQueueTests(
  createJobQueue: () => Promise<JobQueue<TaskInput, TaskOutput>>,
  repositoryName: string
) {
  describe(`TaskGraphJobQueue Tests - ${repositoryName}`, () => {
    let repository: TaskGraphRepository;
    let jobQueue: JobQueue<TaskInput, TaskOutput>;

    beforeEach(async () => {
      jobQueue = await createJobQueue();
    });

    afterEach(async () => {
      await jobQueue.stop();
      await jobQueue.clear();
    });

    it("should run a task via job queue", async () => {
      await jobQueue.start();
      const task = new TestJobTask({
        jobQueue: jobQueue,
        input: { a: 1, b: 2 },
      });
      const result = await task.run();
      expect(result).toEqual({ result: 3 });
    });
    it("should not run a task via job queue if not started", async () => {
      const task = new TestJobTask({
        jobQueue: jobQueue,
        input: { a: 1, b: 2 },
      });
      const wait = (ms: number, result: any) =>
        new Promise((resolve) => setTimeout(resolve, ms, result));
      const result = await Promise.race([task.run(), wait(10, "STOP")]);
      expect(result).toEqual("STOP");
    });
  });
}

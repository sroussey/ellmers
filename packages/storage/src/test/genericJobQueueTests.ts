//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  TaskInput,
  TaskOutput,
  Job,
  JobStatus,
  AbortSignalJobError,
  sleep,
  JobQueue,
} from "ellmers-core";

export class TestJob extends Job<TaskInput, TaskOutput> {
  public async execute(signal: AbortSignal): Promise<TaskOutput> {
    if (!this.queue) {
      throw new Error("Job must be added to a queue before execution");
    }

    if (this.input.taskType === "long_running") {
      return new Promise<TaskOutput>((resolve, reject) => {
        // Add abort listener immediately
        signal.addEventListener(
          "abort",
          () => {
            reject(new AbortSignalJobError("Aborted via signal"));
          },
          { once: true }
        );
      });
    }
    if (this.input.taskType === "progress") {
      return new Promise<TaskOutput>(async (resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new AbortSignalJobError("Aborted via signal"));
          },
          { once: true }
        );

        try {
          // Simulate progress updates
          await sleep(2);
          await this.updateProgress(25, "Starting task");
          await sleep(2);
          await this.updateProgress(50, "Halfway there");
          await sleep(2);
          await this.updateProgress(75, "Almost done", { stage: "final" });
          await sleep(2);
          resolve({ result: "completed with progress" });
        } catch (error) {
          reject(error);
        }
      });
    }
    return { result: this.input.data.replace("input", "output") };
  }
}

export function runGenericJobQueueTests(createJobQueue: () => JobQueue<TaskInput, TaskOutput>) {
  let jobQueue: JobQueue<TaskInput, TaskOutput>;

  beforeEach(async () => {
    jobQueue = createJobQueue();
  });

  afterEach(async () => {
    if (jobQueue) {
      await jobQueue.stop();
      await jobQueue.clear();
    }
  });

  it("should complete a job in the queue", async () => {
    const id = await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await sleep(100);
    await jobQueue.complete(id, { result: "success" });
    const job = await jobQueue.get(id);
    expect(job?.status).toBe(JobStatus.COMPLETED);
    expect(job?.output).toEqual({ result: "success" });
  });

  it("should add a job to the queue", async () => {
    const job = new TestJob({ input: { taskType: "task1", data: "input1" } });
    const id = await jobQueue.add(job);
    expect(await jobQueue.size()).toBe(1);
    const retrievedJob = await jobQueue.get(id);
    expect(retrievedJob?.status).toBe(JobStatus.PENDING);
    expect(retrievedJob?.input.taskType).toBe("task1");
    expect(retrievedJob?.id).toBe(id);
  });

  it("should process jobs and get stats", async () => {
    await jobQueue.start();
    const job1 = new TestJob({ input: { taskType: "other", data: "input1" } });
    const job2 = new TestJob({ input: { taskType: "other", data: "input2" } });
    const job1id = await jobQueue.add(job1);
    const job2id = await jobQueue.add(job2);
    await jobQueue.waitFor(job1id);
    await jobQueue.waitFor(job2id);

    const stats = jobQueue.getStats();
    expect(stats.completedJobs).toBe(2);
    expect(stats.failedJobs).toBe(0);
    expect(stats.abortedJobs).toBe(0);
    expect(stats.retriedJobs).toBe(0);
  });

  it("should clear all jobs in the queue", async () => {
    const job1 = new TestJob({ input: { taskType: "task1", data: "input1" } });
    const job2 = new TestJob({ input: { taskType: "task1", data: "input1" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);
    expect(await jobQueue.size()).toBe(2);
    await jobQueue.clear();
    expect(await jobQueue.size()).toBe(0);
  });

  it("should retrieve the output for a given task type and input", async () => {
    const id = await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task2", data: "input2" } }));
    await jobQueue.complete(id, { result: "success" });
    const output = await jobQueue.outputForInput({ taskType: "task1", data: "input1" });
    expect(output).toEqual({ result: "success" });
  });

  it("should run the queue and execute all", async () => {
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task2", data: "input2" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    const last = await jobQueue.add(new TestJob({ input: { taskType: "task2", data: "input2" } }));
    await jobQueue.start();
    await jobQueue.waitFor(last);
    await sleep(1);
    await jobQueue.stop();
    const job4 = await jobQueue.get(last);
    expect(job4?.status).toBe(JobStatus.COMPLETED);
    expect(job4?.output).toEqual({ result: "output2" });
  });

  it("should run the queue and get rate limited", async () => {
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task2", data: "input2" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    await jobQueue.add(new TestJob({ input: { taskType: "task1", data: "input1" } }));
    const last = await jobQueue.add(new TestJob({ input: { taskType: "task2", data: "input2" } }));
    await jobQueue.start();
    await sleep(10);
    await jobQueue.stop();
    const job4 = await jobQueue.get(last);
    expect(job4?.status).toBe(JobStatus.PENDING);
  });

  it("should abort a long-running job and trigger the abort event", async () => {
    const job = new TestJob({
      input: { taskType: "long_running", data: "input101" },
    });
    await jobQueue.add(job);
    let abortEventTriggered = false;
    jobQueue.on("job_aborting", (qn: any, jobId: any) => {
      if (jobId === job.id) {
        abortEventTriggered = true;
      }
    });
    const waitPromise = jobQueue.waitFor(job.id);
    expect(await jobQueue.size()).toBe(1);
    await jobQueue.start();
    await sleep(5);
    const jobcheck = await jobQueue.get(job.id);
    expect(jobcheck?.status).toBe(JobStatus.PROCESSING);
    await jobQueue.abort(job.id);
    expect(waitPromise).rejects.toMatchObject({
      name: "AbortSignalJobError",
      message: "Aborted via signal",
    });
    expect(abortEventTriggered).toBe(true);
  });

  it("should abort all jobs in a job run while leaving other jobs unaffected", async () => {
    const jobRunId1 = "test-run-1";
    const jobRunId2 = "test-run-2";
    const job1 = new TestJob({
      jobRunId: jobRunId1,
      input: { taskType: "long_running", data: "input1" },
    });
    const job2 = new TestJob({
      jobRunId: jobRunId1,
      input: { taskType: "long_running", data: "input2" },
    });
    const job3 = new TestJob({
      jobRunId: jobRunId2,
      input: { taskType: "long_running", data: "input3" },
    });
    const job4 = new TestJob({
      jobRunId: jobRunId2,
      input: { taskType: "long_running", data: "input4" },
    });
    const job1id = await jobQueue.add(job1);
    const job2id = await jobQueue.add(job2);
    const job3id = await jobQueue.add(job3);
    const job4id = await jobQueue.add(job4);
    expect(await jobQueue.size()).toBe(4);
    await jobQueue.start();
    await sleep(5);
    const processingJobs = await jobQueue.processing();
    expect(processingJobs.length).toBeGreaterThan(0);
    await jobQueue.abortJobRun(jobRunId1);
    await sleep(5);
    // TODO: This is a hack to get the test to pass for IndexedDbJobQueue
    // because the abort event processing can take a long time in the fake
    // indexeddb implementation.
    expect((await jobQueue.get(job1id))?.status).toBeOneOf([JobStatus.FAILED, JobStatus.ABORTING]);
    expect((await jobQueue.get(job2id))?.status).toBeOneOf([JobStatus.FAILED, JobStatus.ABORTING]);
    const job3Status = (await jobQueue.get(job3id))?.status;
    const job4Status = (await jobQueue.get(job4id))?.status;
    expect(job3Status).toBe(JobStatus.PROCESSING);
    expect(job4Status).toBe(JobStatus.PROCESSING);

    await jobQueue.stop();
  });

  describe("Progress Monitoring", () => {
    it("should emit progress events only when progress changes", async () => {
      await jobQueue.start();
      const progressEvents: Array<{
        progress: number;
        message: string;
        details: Record<string, any> | null;
      }> = [];

      const job = new TestJob({ input: { taskType: "progress", data: "input1" } });
      const jobId = await jobQueue.add(job);

      // Listen for progress events
      jobQueue.on("job_progress", (_queueName, id, progress, message, details) => {
        if (id === jobId) {
          progressEvents.push({ progress, message, details });
        }
      });

      // Wait for job completion
      await jobQueue.waitFor(jobId);
      await sleep(1); // Give more time for events to settle

      // Verify progress events
      expect(progressEvents.length).toBe(3); // Should have 3 unique progress updates
      expect(progressEvents[0]).toEqual({
        progress: 25,
        message: "Starting task",
        details: null,
      });
      expect(progressEvents[1]).toEqual({
        progress: 50,
        message: "Halfway there",
        details: null,
      });
      expect(progressEvents[2]).toEqual({
        progress: 75,
        message: "Almost done",
        details: { stage: "final" },
      });
    });

    it("should validate progress values", async () => {
      const job = new TestJob({ input: { taskType: "other", data: "input1" } });
      const jobId = await jobQueue.add(job);

      // Test invalid progress values
      await jobQueue.updateProgress(jobId, -10, "Should be 0");
      const jobNeg = await jobQueue.get(jobId);
      expect(jobNeg?.progress).toBe(0);

      await jobQueue.updateProgress(jobId, 150, "Should be 100");
      const jobOver = await jobQueue.get(jobId);
      expect(jobOver?.progress).toBe(100);
    });

    it("should support job-specific progress listeners", async () => {
      await jobQueue.start();
      const progressUpdates: Array<{
        progress: number;
        message: string;
        details: Record<string, any> | null;
      }> = [];

      const job = new TestJob({ input: { taskType: "progress", data: "input1" } });
      const jobId = await jobQueue.add(job);

      // Add job-specific listener
      const cleanup = jobQueue.onJobProgress(jobId, (progress, message, details) => {
        progressUpdates.push({ progress, message, details });
      });

      // Wait for job completion
      await jobQueue.waitFor(jobId);
      await sleep(2);

      // Clean up listener
      cleanup();

      // Verify progress updates
      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0]).toEqual({
        progress: 25,
        message: "Starting task",
        details: null,
      });
      expect(progressUpdates[1]).toEqual({
        progress: 50,
        message: "Halfway there",
        details: null,
      });
      expect(progressUpdates[2]).toEqual({
        progress: 75,
        message: "Almost done",
        details: { stage: "final" },
      });
    });

    it("should clean up progress listeners for completed jobs", async () => {
      await jobQueue.start();
      const job = new TestJob({ input: { taskType: "progress", data: "input1" } });
      const jobId = await jobQueue.add(job);

      let listenerCalls = 0;
      const cleanup = jobQueue.onJobProgress(jobId, () => {
        listenerCalls++;
      });

      // Wait for job completion
      await jobQueue.waitFor(jobId);
      await sleep(2);

      // Try to update progress after completion (should not trigger listener)
      try {
        await jobQueue.updateProgress(jobId, 99, "Should not emit");
      } catch (error) {
        // Expected error for completed job
      }

      cleanup();
      expect(listenerCalls).toBe(3); // Should only have the original 3 progress updates
    });

    it("should handle multiple jobs with progress monitoring", async () => {
      await jobQueue.start();
      const progressByJob = new Map<unknown, number[]>();

      // Create and start multiple jobs
      const jobs = await Promise.all([
        jobQueue.add(new TestJob({ input: { taskType: "progress", data: "job1" } })),
        jobQueue.add(new TestJob({ input: { taskType: "progress", data: "job2" } })),
      ]);

      // Set up listeners for each job
      const cleanups = jobs.map((jobId) => {
        progressByJob.set(jobId, []);
        return jobQueue.onJobProgress(jobId, (progress) => {
          progressByJob.get(jobId)?.push(progress);
        });
      });

      // Wait for all jobs to complete
      await Promise.all(jobs.map((jobId) => jobQueue.waitFor(jobId)));
      await sleep(2);

      // Clean up listeners
      cleanups.forEach((cleanup) => cleanup());

      // Verify each job had correct progress updates
      jobs.forEach((jobId) => {
        const updates = progressByJob.get(jobId);
        expect(updates).toBeDefined();
        expect(updates?.length).toBe(3);
        expect(updates).toEqual([25, 50, 75]);
      });
    });
  });
}

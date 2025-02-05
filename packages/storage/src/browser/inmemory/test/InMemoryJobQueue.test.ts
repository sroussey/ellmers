//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { AbortSignalJobError, Job, JobStatus, TaskInput, TaskOutput } from "ellmers-core";
import { InMemoryJobQueue, InMemoryRateLimiter } from "ellmers-storage/inmemory";
import { sleep } from "ellmers-core";

class TestJob extends Job<TaskInput, TaskOutput> {
  public async execute() {
    return { result: this.input.data.replace("input", "output") };
  }
}

// A long-running Job that periodically checks if its abort signal is set.
class NeverendingJob extends Job<TaskInput, TaskOutput> {
  async execute(signal?: AbortSignal): Promise<TaskOutput> {
    return new Promise((resolve, reject) => {
      const intervalId = setInterval(() => {
        // If the signal is aborted, clear the interval and reject.
        if (signal?.aborted) {
          clearInterval(intervalId);
          const error = new AbortSignalJobError("Aborted");
          reject(error);
        }
      }, 1);
      // Note: we purposely never call resolve so that the job runs indefinitely
      // until it is aborted.
    });
  }
}

describe("InMemoryJobQueue", () => {
  let jobQueue: InMemoryJobQueue<TaskInput, TaskOutput>;

  beforeEach(() => {
    jobQueue = new InMemoryJobQueue("in_memory_test_queue", new InMemoryRateLimiter(4, 1), 0);
  });

  afterEach(() => {
    jobQueue.clear();
  });

  it("should add a job to the queue", async () => {
    const job = new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job);

    expect(await jobQueue.size()).toBe(1);
    expect(await jobQueue.get("job1")).toBe(job);
  });

  it("should retrieve the next job in the queue", async () => {
    const job1 = new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestJob({ id: "job2", taskType: "task2", input: { data: "input2" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    const nextJob = await jobQueue.next();

    expect(nextJob).toBe(job1);
    expect(nextJob?.status).toBe(JobStatus.PROCESSING);
  });

  it("should complete a job in the queue", async () => {
    const job = new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job);

    await jobQueue.complete("job1", { result: "success" });

    expect(job.status).toBe(JobStatus.COMPLETED);
    expect(job.output).toEqual({ result: "success" });
  });

  it("should clear all jobs in the queue", async () => {
    const job1 = new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestJob({ id: "job2", taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    await jobQueue.clear();

    expect(await jobQueue.size()).toBe(0);
  });

  it("should retrieve the output for a given task type and input", async () => {
    const job1 = new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestJob({ id: "job2", taskType: "task2", input: { data: "input2" } });
    job1.status = JobStatus.COMPLETED;
    job1.output = { result: "output1111" };
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    const output = await jobQueue.outputForInput("task1", { data: "input1" });

    expect(output).toEqual({ result: "output1111" });
  });

  it("should run a job execute method once per job", async () => {
    const job1 = new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestJob({ id: "job2", taskType: "task2", input: { data: "input2" } });
    const job3 = new TestJob({ id: "job3", taskType: "task1", input: { data: "input1" } });
    const job4 = new TestJob({ id: "job4", taskType: "task2", input: { data: "input2" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);
    await jobQueue.add(job3);
    await jobQueue.add(job4);

    const executeSpy1 = spyOn(job1, "execute");
    const executeSpy2 = spyOn(job2, "execute");
    const executeSpy3 = spyOn(job3, "execute");
    const executeSpy4 = spyOn(job4, "execute");

    await jobQueue.start();
    await sleep(5);
    await jobQueue.stop();

    expect(executeSpy1).toHaveBeenCalledTimes(1);
    expect(executeSpy2).toHaveBeenCalledTimes(1);
    expect(executeSpy3).toHaveBeenCalledTimes(1);
    expect(executeSpy4).toHaveBeenCalledTimes(1);
    expect(job4.status).toBe(JobStatus.COMPLETED);
    expect(job4.output).toEqual({ result: "output2" });
  });

  it("should run the queue and get rate limited", async () => {
    await jobQueue.add(new TestJob({ id: "job1", taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ id: "job2", taskType: "task2", input: { data: "input2" } }));
    await jobQueue.add(new TestJob({ id: "job3", taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ id: "job4", taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ id: "job5", taskType: "task1", input: { data: "input1" } }));
    const last = await jobQueue.add(
      new TestJob({ id: "job6", taskType: "task2", input: { data: "input2" } })
    );

    await jobQueue.start();
    await sleep(5);
    await jobQueue.stop();

    const job4 = await jobQueue.get(last);

    expect(job4?.status).toBe(JobStatus.PENDING);
  });

  it("should abort a long-running job and trigger the abort event", async () => {
    const job = new NeverendingJob({
      id: "job1",
      taskType: "long_running",
      input: { data: "input1" },
    });
    await jobQueue.add(job);

    // Listen for the abort event.
    let abortEventTriggered = false;
    jobQueue.on("job_aborting", (queueName, jobId) => {
      if (jobId === job.id) {
        abortEventTriggered = true;
      }
    });

    // Start the queue so that it begins processing jobs.
    await jobQueue.start();

    // Wait briefly to ensure the job has started.
    await sleep(5);

    // Abort the running job.
    await jobQueue.abort(job.id);

    expect(jobQueue.waitFor(job.id)).rejects.toMatchObject({
      name: "AbortSignalJobError",
      message: "Aborted",
    });

    // Confirm that the job_aborting event was emitted.
    expect(abortEventTriggered).toBe(true);
  });

  it("should abort all jobs in a job run while leaving other jobs unaffected", async () => {
    // Create jobs with the same jobRunId
    const jobRunId1 = "test-run-1";
    const jobRunId2 = "test-run-2";

    // Create jobs for first run
    const job1 = new NeverendingJob({
      id: "job1",
      jobRunId: jobRunId1,
      taskType: "long_running",
      input: { data: "input1" },
    });
    const job2 = new NeverendingJob({
      id: "job2",
      jobRunId: jobRunId1,
      taskType: "long_running",
      input: { data: "input2" },
    });

    // Create jobs for second run
    const job3 = new NeverendingJob({
      id: "job3",
      jobRunId: jobRunId2,
      taskType: "long_running",
      input: { data: "input3" },
    });
    const job4 = new NeverendingJob({
      id: "job4",
      jobRunId: jobRunId2,
      taskType: "long_running",
      input: { data: "input4" },
    });

    // Add all jobs to queue
    await jobQueue.add(job1);
    await jobQueue.add(job2);
    await jobQueue.add(job3);
    await jobQueue.add(job4);

    // Start the queue
    await jobQueue.start();
    await sleep(5);

    // Abort the first job run
    await jobQueue.abortJobRun(jobRunId1);
    await sleep(5);

    // Check jobs from first run - should be aborting
    expect((await jobQueue.get("job1"))?.status).toBe(JobStatus.FAILED);
    expect((await jobQueue.get("job2"))?.status).toBe(JobStatus.FAILED);

    // Check jobs from second run - should be unaffected
    const job3Status = (await jobQueue.get("job3"))?.status;
    const job4Status = (await jobQueue.get("job4"))?.status;
    expect(job3Status).toBe(JobStatus.PROCESSING);
    expect(job4Status).toBe(JobStatus.PROCESSING);

    await jobQueue.stop();
  });
});

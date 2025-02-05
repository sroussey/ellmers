//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, afterEach } from "bun:test";
import { TaskInput, TaskOutput, Job, JobStatus, AbortSignalJobError } from "ellmers-core";
import { SqliteRateLimiter } from "../SqliteRateLimiter";
import { SqliteJobQueue } from "../SqliteJobQueue";
import { getDatabase } from "../../../util/db_sqlite";
import { sleep } from "../../../util/Misc";

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
          const error = new AbortSignalJobError("Aborted via signal");
          reject(error);
        }
      }, 1);
      // Note: we purposely never call resolve so that the job runs indefinitely
      // until it is aborted.
    });
  }
}

describe("SqliteJobQueue", () => {
  const db = getDatabase(":memory:");
  const queueName = "sqlite_test_queue";
  const jobQueue = new SqliteJobQueue(
    db,
    queueName,
    new SqliteRateLimiter(db, queueName, 4, 1).ensureTableExists(),
    0,
    TestJob
  ).ensureTableExists();

  afterEach(async () => {
    await jobQueue.clear();
  });

  it("should add a job to the queue", async () => {
    const job = new TestJob({ taskType: "task1", input: { data: "input1" } });
    const id = await jobQueue.add(job);

    expect(await jobQueue.size()).toBe(1);

    const retrievedJob = await jobQueue.get(id!);
    expect(retrievedJob?.status).toBe(JobStatus.PENDING);
    expect(retrievedJob?.taskType).toBe("task1");
  });

  it("should retrieve the next job in the queue", async () => {
    const job1 = new TestJob({ taskType: "task1", input: { data: "input1" } });
    const job2 = new TestJob({ taskType: "task2", input: { data: "input2" } });
    const job1id = await jobQueue.add(job1);
    await jobQueue.add(job2);

    const nextJob = await jobQueue.next();

    expect(nextJob!.id).toBe(job1id);
    expect(nextJob?.status).toBe(JobStatus.PROCESSING);
  });

  it("should complete a job in the queue", async () => {
    const id = await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));

    await jobQueue.complete(id!, { result: "success" });

    const job = await jobQueue.get(id!);

    expect(job?.status).toBe(JobStatus.COMPLETED);
    expect(job?.output).toEqual({ result: "success" });
  });

  it("should clear all jobs in the queue", async () => {
    const job1 = new TestJob({ taskType: "task1", input: { data: "input1" } });
    const job2 = new TestJob({ taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    await jobQueue.clear();

    expect(await jobQueue.size()).toBe(0);
  });

  it("should retrieve the output for a given task type and input", async () => {
    const id = await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));

    await jobQueue.complete(id!, { result: "success" });

    const output = await jobQueue.outputForInput("task1", { data: "input1" });

    expect(output).toEqual({ result: "success" });
  });

  it("should run the queue and execute all", async () => {
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    const last = await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));

    await jobQueue.start();
    await sleep(5);
    await jobQueue.stop();

    const job4 = await jobQueue.get(last!);

    expect(job4?.status).toBe(JobStatus.COMPLETED);
    expect(job4?.output).toEqual({ result: "output2" });
  });

  it("should run the queue and get rate limited", async () => {
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    const last = await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));

    await jobQueue.start();
    await sleep(5);
    await jobQueue.stop();

    const job4 = await jobQueue.get(last!);

    expect(job4?.status).toBe(JobStatus.PENDING);
  });

  it("should abort a long-running job and trigger the abort event", async () => {
    const queueName = "sqlite_test_queue_2";
    const jobQueue = new SqliteJobQueue(
      db,
      queueName,
      new SqliteRateLimiter(db, queueName, 4, 1).ensureTableExists(),
      0,
      NeverendingJob
    ).ensureTableExists();

    const job = new NeverendingJob({
      taskType: "long_running",
      input: { data: "input101" },
    });

    await jobQueue.add(job);

    // Listen for the abort event.
    let abortEventTriggered = false;
    jobQueue.on("job_aborting", (queueName, jobId) => {
      if (jobId === job.id) {
        abortEventTriggered = true;
      }
    });
    const waitPromise = jobQueue.waitFor(job.id);

    // Start the queue so that it begins processing jobs.
    await jobQueue.start();

    // Wait briefly to ensure the job has started.
    await sleep(5);

    {
      const jobcheck = await jobQueue.get(job.id as string);
      expect(jobcheck?.status).toBe(JobStatus.PROCESSING);
    }

    // // Abort the running job.
    await jobQueue.abort(job.id as string);

    expect(waitPromise).rejects.toMatchObject({
      name: "AbortSignalJobError",
      message: "Aborted via signal",
    });

    // Confirm that the job_aborting event was emitted.
    expect(abortEventTriggered).toBe(true);
  });
});

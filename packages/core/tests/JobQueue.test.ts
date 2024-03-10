//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { LocalJobQueue } from "../src/job/LocalJobQueue";
import { Job, JobConstructorDetails, JobStatus } from "../src/job/Job";
import { DelayLimiter } from "../src/job/DelayLimiter";
import { SqliteRateLimiter } from "../src/job/SqliteRateLimiter";
import { SqliteJobQueue } from "../src/job/SqliteJobQueue";
import { getDatabase } from "../src/util/db_sqlite";
import { sleep } from "../src/util/Misc";

class TestJob extends Job {
  public async execute() {
    return { result: this.input.data.replace("input", "output") };
  }
}

describe("LocalJobQueue", () => {
  let jobQueue: LocalJobQueue;

  beforeEach(() => {
    jobQueue = new LocalJobQueue("in_memory_test_queue", new DelayLimiter(0), 0);
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
    job1.output = { result: "output1" };
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    const output = await jobQueue.outputForInput("task1", { data: "input1" });

    expect(output).toEqual({ result: "output1" });
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

    jobQueue.start();
    await sleep(100);
    jobQueue.stop();

    expect(executeSpy1).toHaveBeenCalledTimes(1);
    expect(executeSpy2).toHaveBeenCalledTimes(1);
    expect(executeSpy3).toHaveBeenCalledTimes(1);
    expect(executeSpy4).toHaveBeenCalledTimes(1);
    expect(job4.status).toBe(JobStatus.COMPLETED);
    expect(job4.output).toEqual({ result: "output2" });
  });
});

describe("SqliteJobQueue", () => {
  let db = getDatabase(":memory:");
  let queueName = "sqlite_test_queue";
  let jobQueue = new SqliteJobQueue(
    db,
    queueName,
    new SqliteRateLimiter(db, queueName, 4, 1),
    TestJob,
    0
  );

  afterEach(() => {
    jobQueue.clear();
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

  it("should run a job execute method once per job", async () => {
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    const job4id = await jobQueue.add(
      new TestJob({ taskType: "task2", input: { data: "input2" } })
    );

    jobQueue.start();
    await sleep(100);
    jobQueue.stop();

    const job4 = await jobQueue.get(job4id!);

    expect(job4?.status).toBe(JobStatus.COMPLETED);
    expect(job4?.output).toEqual({ result: "output2" });
  });
});

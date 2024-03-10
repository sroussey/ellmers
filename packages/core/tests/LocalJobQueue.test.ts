//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { LocalJobQueue, LocalJob } from "../src/job/LocalJobQueue";
import { JobConstructorDetails, JobStatus } from "../src/job/Job";
import { DelayLimiter } from "../src/job/DelayLimiter";
import { sleep } from "../dist/server";

class TestLocalJobQueue extends LocalJobQueue {}

class TestLocalJob extends LocalJob {
  constructor(details: Omit<JobConstructorDetails, "queue">) {
    super({ ...details, queue: "test" });
  }
  public async execute() {
    return { result: this.input.data.replace("input", "output") };
  }
}

describe("LocalJobQueue", () => {
  let jobQueue: TestLocalJobQueue;

  beforeEach(() => {
    jobQueue = new TestLocalJobQueue("test", new DelayLimiter(0), 0);
  });

  afterEach(() => {
    jobQueue.clear();
  });

  it("should add a job to the queue", async () => {
    const job = new TestLocalJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job);

    expect(await jobQueue.size()).toBe(1);
    expect(await jobQueue.get("job1")).toBe(job);
  });

  it("should retrieve the next job in the queue", async () => {
    const job1 = new TestLocalJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestLocalJob({ id: "job2", taskType: "task2", input: { data: "input2" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    const nextJob = await jobQueue.next();

    expect(nextJob).toBe(job1);
    expect(nextJob?.status).toBe(JobStatus.PROCESSING);
  });

  it("should complete a job in the queue", async () => {
    const job = new TestLocalJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job);

    await jobQueue.complete("job1", { result: "success" });

    expect(job.status).toBe(JobStatus.COMPLETED);
    expect(job.output).toEqual({ result: "success" });
  });

  it("should clear all jobs in the queue", async () => {
    const job1 = new TestLocalJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestLocalJob({ id: "job2", taskType: "task1", input: { data: "input1" } });
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    await jobQueue.clear();

    expect(await jobQueue.size()).toBe(0);
  });

  it("should retrieve the output for a given task type and input", async () => {
    const job1 = new TestLocalJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestLocalJob({ id: "job2", taskType: "task2", input: { data: "input2" } });
    job1.status = JobStatus.COMPLETED;
    job1.output = { result: "output1" };
    await jobQueue.add(job1);
    await jobQueue.add(job2);

    const output = await jobQueue.outputForInput("task1", { data: "input1" });

    expect(output).toEqual({ result: "output1" });
  });

  it("should run a job execute method once per job", async () => {
    const job1 = new TestLocalJob({ id: "job1", taskType: "task1", input: { data: "input1" } });
    const job2 = new TestLocalJob({ id: "job2", taskType: "task2", input: { data: "input2" } });
    const job3 = new TestLocalJob({ id: "job3", taskType: "task1", input: { data: "input1" } });
    const job4 = new TestLocalJob({ id: "job4", taskType: "task2", input: { data: "input2" } });
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

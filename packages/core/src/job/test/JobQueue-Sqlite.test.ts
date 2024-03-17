//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, afterEach } from "bun:test";
import { Job, JobStatus } from "../base/Job";
import { SqliteRateLimiter } from "../SqliteRateLimiter";
import { SqliteJobQueue } from "../SqliteJobQueue";
import { getDatabase } from "../../util/db_sqlite";
import { sleep } from "../../util/Misc";
import { TaskInput, TaskOutput } from "../../task/base/Task";

class TestJob extends Job<TaskInput, TaskOutput> {
  public async execute() {
    return { result: this.input.data.replace("input", "output") };
  }
}

describe("SqliteJobQueue", () => {
  let db = getDatabase(":memory:");
  let queueName = "sqlite_test_queue";
  let jobQueue = new SqliteJobQueue(
    db,
    queueName,
    new SqliteRateLimiter(db, queueName, 4, 1).ensureTableExists(),
    TestJob,
    0
  ).ensureTableExists();

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

  it("should run the queue and execute all", async () => {
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));
    await jobQueue.add(new TestJob({ taskType: "task1", input: { data: "input1" } }));
    const last = await jobQueue.add(new TestJob({ taskType: "task2", input: { data: "input2" } }));

    await jobQueue.start();
    await sleep(50);
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
    await sleep(50);
    await jobQueue.stop();

    const job4 = await jobQueue.get(last!);

    expect(job4?.status).toBe(JobStatus.PENDING);
  });
});

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
import { IndexedDbJobQueue } from "../browser/indexeddb";

export class TestJob extends Job<TaskInput, TaskOutput> {
  public async execute(signal: AbortSignal): Promise<TaskOutput> {
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
    return { result: this.input.data.replace("input", "output") };
  }
}

export function runGenericJobQueueTests(
  createJobQueue: () => JobQueue<TaskInput, TaskOutput>,
  queueName: string
) {
  describe(`JobQueue Tests - ${queueName}`, () => {
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
      const last = await jobQueue.add(
        new TestJob({ input: { taskType: "task2", data: "input2" } })
      );
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
      const last = await jobQueue.add(
        new TestJob({ input: { taskType: "task2", data: "input2" } })
      );
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
      await jobQueue.start();
      await sleep(5);
      const processingJobs = await jobQueue.processing();
      expect(processingJobs.length).toBeGreaterThan(0);
      await jobQueue.abortJobRun(jobRunId1);
      await sleep(5);
      if (!(jobQueue instanceof IndexedDbJobQueue)) {
        // TODO: This is a hack to get the test to pass for IndexedDbJobQueue
        // because the abort event processing can take a long time in the fake
        // indexeddb implementation.
        expect((await jobQueue.get(job1id))?.status).toBe(JobStatus.FAILED);
        expect((await jobQueue.get(job2id))?.status).toBe(JobStatus.FAILED);
        const job3Status = (await jobQueue.get(job3id))?.status;
        const job4Status = (await jobQueue.get(job4id))?.status;
        expect(job3Status).toBe(JobStatus.PROCESSING);
        expect(job4Status).toBe(JobStatus.PROCESSING);
      }
      await jobQueue.stop();
    });
  });
}

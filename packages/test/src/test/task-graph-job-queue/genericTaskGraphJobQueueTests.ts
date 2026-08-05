/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext } from "@workglow/job-queue";
import { Job } from "@workglow/job-queue";
import type {
  IExecuteContext,
  RegisteredQueue,
  TaskConfig,
  TaskInput,
  TaskOutput,
} from "@workglow/task-graph";
import {
  getTaskQueueRegistry,
  JobTaskFailedError,
  Task,
  TaskConfigSchema,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, expect, it } from "vitest";

export class TestJob extends Job<TaskInput, TaskOutput> {
  override async execute(input: TaskInput, context: IJobExecuteContext): Promise<TaskOutput> {
    return { result: (input as any).a + (input as any).b };
  }
}

type TestJobTaskConfig = TaskConfig & { queue?: boolean | string };

const testJobTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    queue: {
      oneOf: [{ type: "boolean" }, { type: "string" }],
      description: "Queue handling: false=run inline, true=use default, string=explicit queue name",
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export class TestJobTask extends Task<
  { a: number; b: number },
  { result: number },
  TestJobTaskConfig
> {
  static override readonly type: string = "TestJobTask";

  static override configSchema(): DataPortSchema {
    return testJobTaskConfigSchema;
  }

  static override readonly inputSchema = (): DataPortSchema =>
    ({
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      additionalProperties: false,
      required: ["a", "b"],
    }) as const satisfies DataPortSchema;
  static override readonly outputSchema = (): DataPortSchema =>
    ({
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
      required: ["result"],
    }) as const satisfies DataPortSchema;

  override async execute(
    input: { a: number; b: number },
    executeContext: IExecuteContext
  ): Promise<{ result: number } | undefined> {
    const queuePref = this.config.queue ?? false;
    let cleanup: () => void = () => {};

    try {
      if (queuePref === false) {
        const job = new TestJob({ input });
        cleanup = job.onJobProgress(
          (progress: number, message: string, details: Record<string, any> | null) => {
            executeContext.updateProgress(progress, message, details);
          }
        );
        return (await job.execute(input, {
          signal: executeContext.signal,
          updateProgress: executeContext.updateProgress.bind(this),
        })) as { result: number };
      }

      const queueName = typeof queuePref === "string" ? queuePref : this.type;
      const registry = getTaskQueueRegistry();
      const registeredQueue = registry.getQueue<{ a: number; b: number }, { result: number }>(
        queueName
      );

      if (!registeredQueue) {
        throw new Error(`Queue "${queueName}" not found`);
      }

      const handle = await registeredQueue.client.send(input, {
        jobRunId: this.runConfig.runnerId,
        maxAttempts: 10,
      });

      cleanup = handle.onProgress(
        (progress: number, message: string | undefined, details: Record<string, any> | null) => {
          executeContext.updateProgress(progress, message, details);
        }
      );

      const output = await handle.waitFor();
      return output as { result: number };
    } catch (err: any) {
      throw new JobTaskFailedError(err);
    } finally {
      cleanup();
    }
  }
}

export function runGenericTaskGraphJobQueueTests(
  createQueue: () => Promise<RegisteredQueue<TaskInput, TaskOutput>>
): void {
  let registeredQueue: RegisteredQueue<TaskInput, TaskOutput>;

  beforeEach(async () => {
    registeredQueue = await createQueue();
    getTaskQueueRegistry().registerQueue(registeredQueue);
  });

  afterEach(async () => {
    await registeredQueue.server.stop();
    await registeredQueue.storage.deleteAll();
  });

  it("should run a task via job queue", async () => {
    await registeredQueue.server.start();
    const task = new TestJobTask({
      queue: registeredQueue.server.queueName,
      defaults: { a: 1, b: 2 },
    });
    const result = await task.run();
    expect(result).toEqual({ result: 3 });
  });

  it("should not run a task via job queue if not started", async () => {
    const task = new TestJobTask({
      queue: registeredQueue.server.queueName,
      defaults: { a: 1, b: 2 },
    });
    const wait = (ms: number, result: unknown) =>
      new Promise((resolve) => setTimeout(resolve, ms, result));
    const result = await Promise.race([task.run(), wait(10, "STOP")]);
    expect(result).toEqual("STOP");
  });
}

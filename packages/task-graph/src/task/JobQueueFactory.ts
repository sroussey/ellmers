/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Job,
  JobConstructorParam,
  JobQueueClient,
  JobQueueServer,
  JobQueueServerOptions,
} from "@workglow/job-queue";
import { InMemoryQueueStorage, IQueueStorage } from "@workglow/storage";
import { createServiceToken, globalServiceRegistry } from "@workglow/util";
import type { RegisteredQueue } from "./TaskQueueRegistry";
import type { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";

export type JobClassConstructor<Input extends TaskInput, Output extends TaskOutput> = new (
  params: JobConstructorParam<Input, Output>
) => Job<Input, Output>;

/**
 * Options for creating a job queue via the factory
 */
export interface JobQueueFactoryOptions<Input, Output> {
  readonly storage?: IQueueStorage<Input, Output>;
  readonly limiter?: JobQueueServerOptions<Input, Output>["limiter"];
  readonly workerCount?: number;
  readonly pollIntervalMs?: number;
  readonly deleteAfterCompletionMs?: number;
  readonly deleteAfterFailureMs?: number;
  readonly deleteAfterDisabledMs?: number;
  readonly cleanupIntervalMs?: number;
  readonly stopTimeoutMs?: number;
}

export interface JobQueueFactoryParams<Input extends TaskInput, Output extends TaskOutput> {
  readonly queueName: string;
  readonly jobClass: JobClassConstructor<Input, Output>;
  readonly input?: Input;
  readonly config?: TaskConfig;
  readonly task?: unknown;
  readonly options?: JobQueueFactoryOptions<Input, Output>;
}

export type JobQueueFactory = <Input extends TaskInput, Output extends TaskOutput>(
  params: JobQueueFactoryParams<Input, Output>
) => Promise<RegisteredQueue<Input, Output>> | RegisteredQueue<Input, Output>;

export const JOB_QUEUE_FACTORY = createServiceToken<JobQueueFactory>("taskgraph.jobQueueFactory");

const defaultJobQueueFactory: JobQueueFactory = async <
  Input extends TaskInput,
  Output extends TaskOutput,
>({
  queueName,
  jobClass,
  options,
}: JobQueueFactoryParams<Input, Output>): Promise<RegisteredQueue<Input, Output>> => {
  const storage =
    (options?.storage as IQueueStorage<Input, Output>) ??
    new InMemoryQueueStorage<Input, Output>(queueName);
  await storage.setupDatabase();

  const server = new JobQueueServer<Input, Output>(jobClass as JobClassConstructor<any, any>, {
    storage,
    queueName,
    limiter: options?.limiter,
    workerCount: options?.workerCount,
    pollIntervalMs: options?.pollIntervalMs,
    deleteAfterCompletionMs: options?.deleteAfterCompletionMs,
    deleteAfterFailureMs: options?.deleteAfterFailureMs,
    deleteAfterDisabledMs: options?.deleteAfterDisabledMs,
    cleanupIntervalMs: options?.cleanupIntervalMs,
    stopTimeoutMs: options?.stopTimeoutMs,
  });

  const client = new JobQueueClient<Input, Output>({
    storage,
    queueName,
  });

  // Attach client to server for same-process optimization
  client.attach(server);

  return { server, client, storage };
};

export function registerJobQueueFactory(factory: JobQueueFactory): void {
  globalServiceRegistry.registerInstance(JOB_QUEUE_FACTORY, factory);
}

/**
 * Creates a job queue factory from server options
 */
export function createJobQueueFactoryWithOptions(
  defaultOptions: Partial<JobQueueFactoryOptions<unknown, unknown>> = {}
): JobQueueFactory {
  return async <Input extends TaskInput, Output extends TaskOutput>({
    queueName,
    jobClass,
    options,
  }: JobQueueFactoryParams<Input, Output>): Promise<RegisteredQueue<Input, Output>> => {
    const mergedOptions = {
      ...defaultOptions,
      ...(options ?? {}),
    } as JobQueueFactoryOptions<Input, Output>;

    const storage =
      (mergedOptions.storage as IQueueStorage<Input, Output>) ??
      new InMemoryQueueStorage<Input, Output>(queueName);
    await storage.setupDatabase();

    const server = new JobQueueServer<Input, Output>(jobClass as JobClassConstructor<any, any>, {
      storage,
      queueName,
      limiter: mergedOptions.limiter,
      workerCount: mergedOptions.workerCount,
      pollIntervalMs: mergedOptions.pollIntervalMs,
      deleteAfterCompletionMs: mergedOptions.deleteAfterCompletionMs,
      deleteAfterFailureMs: mergedOptions.deleteAfterFailureMs,
      deleteAfterDisabledMs: mergedOptions.deleteAfterDisabledMs,
      cleanupIntervalMs: mergedOptions.cleanupIntervalMs,
      stopTimeoutMs: mergedOptions.stopTimeoutMs,
    });

    const client = new JobQueueClient<Input, Output>({
      storage,
      queueName,
    });

    // Attach client to server for same-process optimization
    client.attach(server);

    return { server, client, storage };
  };
}

export function getJobQueueFactory(): JobQueueFactory {
  if (!globalServiceRegistry.has(JOB_QUEUE_FACTORY)) {
    registerJobQueueFactory(defaultJobQueueFactory);
  }
  return globalServiceRegistry.get(JOB_QUEUE_FACTORY);
}

if (!globalServiceRegistry.has(JOB_QUEUE_FACTORY)) {
  registerJobQueueFactory(defaultJobQueueFactory);
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IQueueStorage, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { EventEmitter } from "@workglow/util";

/**
 * Combined structure for a registered job queue containing server, client, and storage
 */
export interface RegisteredQueue<Input = unknown, Output = unknown> {
  readonly server: JobQueueServer<Input, Output>;
  readonly client: JobQueueClient<Input, Output>;
  readonly storage: IQueueStorage<Input, Output>;
}

/**
 * Global singleton instance of the TaskQueueRegistry.
 * This is used to manage all job queues across the application.
 */
let taskQueueRegistry: TaskQueueRegistry | null = null;

/**
 * Registry for managing task queues in the application.
 * Provides functionality to register, manage, and control job queues.
 *
 * @template Input - The type of input data for tasks in the queues
 * @template Output - The type of output data for tasks in the queues
 */
export type TaskQueueRegistryEvents = {
  queue_registered: (queueName: string) => void;
};

export class TaskQueueRegistry {
  /**
   * Emits when queues are registered ({@link TaskQueueRegistryEvents}).
   */
  public readonly emitter = new EventEmitter<TaskQueueRegistryEvents>();

  /**
   * Map of queue names to their corresponding registered queue instances
   */
  public readonly queues: Map<string, RegisteredQueue<unknown, unknown>> = new Map();

  /**
   * Registers a new job queue with the registry
   *
   * @param queue - The registered queue containing server, client, and storage
   * @throws Error if a queue with the same name already exists
   */
  registerQueue<Input, Output>(queue: RegisteredQueue<Input, Output>): void {
    const queueName = queue.server.queueName;
    if (this.queues.has(queueName)) {
      throw new Error(`Queue with name ${queueName} already exists`);
    }
    this.queues.set(queueName, queue as RegisteredQueue<unknown, unknown>);
    this.emitter.emit("queue_registered", queueName);
  }

  /**
   * Retrieves a registered queue by its name
   *
   * @param queueName - The name of the queue to retrieve
   * @returns The registered queue or undefined if not found
   */
  getQueue<Input, Output>(queueName: string): RegisteredQueue<Input, Output> | undefined {
    return this.queues.get(queueName) as RegisteredQueue<Input, Output> | undefined;
  }

  /**
   * Starts all registered job queue servers
   * This allows queues to begin processing their jobs
   *
   * @returns The registry instance for chaining
   */
  async startQueues() {
    for (const queue of this.queues.values()) {
      await queue.server.start();
    }
  }

  /**
   * Stops all registered job queue servers
   * This pauses job processing but maintains the queued jobs
   *
   * @returns The registry instance for chaining
   */
  async stopQueues() {
    for (const queue of this.queues.values()) {
      await queue.server.stop();
    }
  }

  /**
   * Clears all registered job queues
   * This removes all queued jobs from the storage
   *
   * @returns The registry instance for chaining
   */
  async clearQueues() {
    for (const queue of this.queues.values()) {
      await queue.storage.deleteAll();
    }
  }
}

/**
 * Gets the global TaskQueueRegistry instance
 * Creates a new instance if one doesn't exist
 *
 * @returns The global TaskQueueRegistry instance
 */
export function getTaskQueueRegistry(): TaskQueueRegistry {
  if (!taskQueueRegistry) {
    taskQueueRegistry = new TaskQueueRegistry();
  }
  return taskQueueRegistry;
}

/**
 * Sets the global TaskQueueRegistry instance
 * Stops and clears any existing registry before replacing it
 *
 * @param registry - The new registry instance to use, or null to clear
 */
export async function setTaskQueueRegistry(registry: TaskQueueRegistry | null): Promise<void> {
  if (taskQueueRegistry) {
    await taskQueueRegistry.stopQueues();
    await taskQueueRegistry.clearQueues();
  }
  taskQueueRegistry = registry;
}

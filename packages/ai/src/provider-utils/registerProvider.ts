/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkerServerBase } from "@workglow/util/worker";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
import type { AiProviderRegisterOptions } from "../provider/AiProvider";

/**
 * Shared helper for worker-side provider registration.
 * Retrieves the WorkerServer, calls the provider factory to register task
 * run functions, signals readiness, and logs the result.
 *
 * @param createAndRegister - Callback that creates the provider and calls
 *   `registerOnWorkerServer(workerServer)`. Receives the WorkerServer instance.
 * @param providerName - Human-readable name for the log message.
 */
export async function registerProviderWorker(
  createAndRegister: (workerServer: WorkerServerBase) => void,
  providerName: string
): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  createAndRegister(workerServer);
  workerServer.sendReady();
  getLogger().info(`${providerName} worker job run functions registered`);
}

/**
 * Shared helper for main-thread inline provider registration.
 * Calls `register()` on an already-constructed provider instance.
 *
 * @param provider - A constructed QueuedProvider with task run functions.
 * @param providerName - Human-readable name for the log message.
 * @param options - Registration options (queue concurrency, etc.).
 */
export async function registerProviderInline(
  provider: { register(options: AiProviderRegisterOptions): Promise<void> },
  providerName: string,
  options?: AiProviderRegisterOptions
): Promise<void> {
  await provider.register(options ?? {});
  getLogger().debug(`${providerName} inline job run functions registered`);
}

/**
 * Shared helper for main-thread worker-backed provider registration.
 * Calls `register()` on a QueuedProvider constructed without task functions
 * (the worker handles execution).
 *
 * @param provider - A constructed QueuedProvider (no task functions).
 * @param providerName - Human-readable name for the log message.
 * @param options - Registration options including the required `worker`.
 */
export async function registerProviderWithWorker(
  provider: { register(options: AiProviderRegisterOptions): Promise<void> },
  providerName: string,
  options: AiProviderRegisterOptions & { worker: Worker | (() => Worker) }
): Promise<void> {
  await provider.register(options);
  getLogger().debug(`${providerName} worker main thread job run functions registered`);
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "@workglow/ai/provider-utils";
import { LlamaCppServerQueuedProvider } from "./LlamaCppServerQueuedProvider";

/**
 * Main-thread worker-backed registration. The provider proxy lives on the
 * main thread and forwards jobs to the worker, which holds the real run-fns.
 *
 * Use {@link registerLlamaCppServerInline} for transport mode (broker
 * acquisition).
 */
export async function registerLlamaCppServer(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await registerProviderWithWorker(new LlamaCppServerQueuedProvider(), "LlamaCppServer", options);
}

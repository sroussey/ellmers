/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "@workglow/ai/provider-utils";
import { StableDiffusionCppQueuedProvider } from "./StableDiffusionCppQueuedProvider";

/**
 * Main-thread worker-backed registration. The provider proxy lives on the
 * main thread and forwards jobs to the worker, which holds the real run-fns.
 *
 * Use {@link registerStableDiffusionCppInline} for transport mode within a
 * single thread.
 */
export async function registerStableDiffusionCpp(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await registerProviderWithWorker(
    new StableDiffusionCppQueuedProvider(),
    "StableDiffusionCpp",
    options
  );
}

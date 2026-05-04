/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "@workglow/ai-provider/common";
import { LlamaCppQueuedProvider } from "./LlamaCppQueuedProvider";

export async function registerLlamaCpp(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await registerProviderWithWorker(new LlamaCppQueuedProvider(), "LlamaCpp", options);
}

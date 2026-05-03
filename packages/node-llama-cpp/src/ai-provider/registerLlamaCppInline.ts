/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai-provider/common";
import {
  LLAMACPP_PREVIEW_TASKS,
  LLAMACPP_STREAM_TASKS,
  LLAMACPP_TASKS,
} from "./common/LlamaCpp_JobRunFns";
import { LlamaCppQueuedProvider } from "./LlamaCppQueuedProvider";

export async function registerLlamaCppInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new LlamaCppQueuedProvider(LLAMACPP_TASKS, LLAMACPP_STREAM_TASKS, LLAMACPP_PREVIEW_TASKS),
    "LlamaCpp",
    options
  );
}

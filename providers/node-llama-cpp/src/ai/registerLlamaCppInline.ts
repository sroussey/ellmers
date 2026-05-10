/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { LLAMACPP_PREVIEW_TASKS, LLAMACPP_RUN_FNS } from "./common/LlamaCpp_JobRunFns";
import { LlamaCppQueuedProvider } from "./LlamaCppQueuedProvider";

export async function registerLlamaCppInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new LlamaCppQueuedProvider(LLAMACPP_RUN_FNS, LLAMACPP_PREVIEW_TASKS),
    "LlamaCpp",
    options
  );
}

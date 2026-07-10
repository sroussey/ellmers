/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { OPENROUTER_PREVIEW_TASKS, OPENROUTER_RUN_FNS } from "./common/OpenRouter_JobRunFns";
import { OpenRouterQueuedProvider } from "./OpenRouterQueuedProvider";

export async function registerOpenRouterInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new OpenRouterQueuedProvider(OPENROUTER_RUN_FNS, OPENROUTER_PREVIEW_TASKS),
    "OpenRouter",
    options
  );
}

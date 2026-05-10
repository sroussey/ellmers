/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { OPENAI_PREVIEW_TASKS, OPENAI_RUN_FNS } from "./common/OpenAI_JobRunFns.browser";
import { OpenAiQueuedProvider } from "./OpenAiQueuedProvider";

export async function registerOpenAiInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new OpenAiQueuedProvider(OPENAI_RUN_FNS, OPENAI_PREVIEW_TASKS),
    "OpenAI",
    options
  );
}

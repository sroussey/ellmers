/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai-provider/common";
import {
  OPENAI_PREVIEW_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "./common/OpenAI_JobRunFns.browser";
import { OpenAiQueuedProvider } from "./OpenAiQueuedProvider";

export async function registerOpenAiInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new OpenAiQueuedProvider(OPENAI_TASKS, OPENAI_STREAM_TASKS, OPENAI_PREVIEW_TASKS),
    "OpenAI",
    options
  );
}

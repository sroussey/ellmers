/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { registerOpenAiImageValidator } from "./common/OpenAI_ImageValidation";
import { OPENAI_PREVIEW_TASKS, OPENAI_RUN_FNS } from "./common/OpenAI_JobRunFns";
import { OpenAiQueuedProvider } from "./OpenAiQueuedProvider";

export async function registerOpenAiInline(options?: AiProviderRegisterOptions): Promise<void> {
  registerOpenAiImageValidator();
  await registerProviderInline(
    new OpenAiQueuedProvider(OPENAI_RUN_FNS, OPENAI_PREVIEW_TASKS),
    "OpenAI",
    options
  );
}

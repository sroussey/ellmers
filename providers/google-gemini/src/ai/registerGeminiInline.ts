/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { GEMINI_PREVIEW_TASKS, GEMINI_RUN_FNS } from "./common/Gemini_JobRunFns";
import { GoogleGeminiQueuedProvider } from "./GoogleGeminiQueuedProvider";
import { registerGeminiImageValidator } from "./common/Gemini_ImageValidation";

export async function registerGeminiInline(options?: AiProviderRegisterOptions): Promise<void> {
  registerGeminiImageValidator();
  await registerProviderInline(
    new GoogleGeminiQueuedProvider(GEMINI_RUN_FNS, GEMINI_PREVIEW_TASKS),
    "Google Gemini",
    options
  );
}

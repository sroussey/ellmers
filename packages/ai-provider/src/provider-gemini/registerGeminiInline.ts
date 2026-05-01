/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "../common/registerProvider";
import { GEMINI_PREVIEW_TASKS, GEMINI_STREAM_TASKS, GEMINI_TASKS } from "./common/Gemini_JobRunFns";
import { GoogleGeminiQueuedProvider } from "./GoogleGeminiQueuedProvider";
import { registerGeminiImageValidator } from "./common/Gemini_ImageValidation";

export async function registerGeminiInline(options?: AiProviderRegisterOptions): Promise<void> {
  registerGeminiImageValidator();
  await registerProviderInline(
    new GoogleGeminiQueuedProvider(GEMINI_TASKS, GEMINI_STREAM_TASKS, GEMINI_PREVIEW_TASKS),
    "Google Gemini",
    options
  );
}

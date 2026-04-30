/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "../common/registerProvider";
import { GoogleGeminiQueuedProvider } from "./GoogleGeminiQueuedProvider";
import { registerGeminiImageValidator } from "./common/Gemini_ImageValidation";

export async function registerGemini(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  registerGeminiImageValidator();
  await registerProviderWithWorker(new GoogleGeminiQueuedProvider(), "Google Gemini", options);
}

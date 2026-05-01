/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "../common/registerProvider";
import { OpenAiQueuedProvider } from "./OpenAiQueuedProvider";
import { registerOpenAiImageValidator } from "./common/OpenAI_ImageValidation";

export async function registerOpenAi(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  registerOpenAiImageValidator();
  await registerProviderWithWorker(new OpenAiQueuedProvider(), "OpenAI", options);
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai-provider/common";
import { OLLAMA_STREAM_TASKS, OLLAMA_TASKS } from "./common/Ollama_JobRunFns.browser";
import { OllamaQueuedProvider } from "./OllamaQueuedProvider";

export async function registerOllamaInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new OllamaQueuedProvider(OLLAMA_TASKS, OLLAMA_STREAM_TASKS),
    "Ollama",
    options
  );
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { OLLAMA_STREAM_TASKS, OLLAMA_TASKS } from "./common/Ollama_JobRunFns";
import { OllamaProvider } from "./OllamaProvider";

export async function registerOllamaWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new OllamaProvider(OLLAMA_TASKS, OLLAMA_STREAM_TASKS).registerOnWorkerServer(ws),
    "Ollama"
  );
}

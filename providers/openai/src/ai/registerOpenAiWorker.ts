/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { OPENAI_PREVIEW_TASKS, OPENAI_RUN_FNS } from "./common/OpenAI_JobRunFns";
import { OpenAiProvider } from "./OpenAiProvider";

export async function registerOpenAiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new OpenAiProvider(OPENAI_RUN_FNS, OPENAI_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "OpenAI"
  );
}

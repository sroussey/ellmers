/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { OPENROUTER_PREVIEW_TASKS, OPENROUTER_RUN_FNS } from "./common/OpenRouter_JobRunFns";
import { OpenRouterProvider } from "./OpenRouterProvider";

export async function registerOpenRouterWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new OpenRouterProvider(OPENROUTER_RUN_FNS, OPENROUTER_PREVIEW_TASKS).registerOnWorkerServer(
        ws
      ),
    "OpenRouter"
  );
}

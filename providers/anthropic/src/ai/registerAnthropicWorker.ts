/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { AnthropicProvider } from "./AnthropicProvider";
import { ANTHROPIC_PREVIEW_TASKS, ANTHROPIC_RUN_FNS } from "./common/Anthropic_JobRunFns";

export async function registerAnthropicWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new AnthropicProvider(ANTHROPIC_RUN_FNS, ANTHROPIC_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "Anthropic"
  );
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai-provider/common";
import {
  ANTHROPIC_PREVIEW_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_TASKS,
} from "./common/Anthropic_JobRunFns";
import { AnthropicProvider } from "./AnthropicProvider";

export async function registerAnthropicWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new AnthropicProvider(
        ANTHROPIC_TASKS,
        ANTHROPIC_STREAM_TASKS,
        ANTHROPIC_PREVIEW_TASKS
      ).registerOnWorkerServer(ws),
    "Anthropic"
  );
}

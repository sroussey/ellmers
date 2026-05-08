/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import {
  OPENAI_PREVIEW_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "./common/OpenAI_JobRunFns.browser";
import { OpenAiProvider } from "./OpenAiProvider";

export async function registerOpenAiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new OpenAiProvider(
        OPENAI_TASKS,
        OPENAI_STREAM_TASKS,
        OPENAI_PREVIEW_TASKS
      ).registerOnWorkerServer(ws),
    "OpenAI"
  );
}

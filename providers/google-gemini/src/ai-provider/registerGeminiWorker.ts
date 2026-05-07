/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai-provider/common";
import { GEMINI_PREVIEW_TASKS, GEMINI_STREAM_TASKS, GEMINI_TASKS } from "./common/Gemini_JobRunFns";
import { GoogleGeminiProvider } from "./GoogleGeminiProvider";

export async function registerGeminiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new GoogleGeminiProvider(
        GEMINI_TASKS,
        GEMINI_STREAM_TASKS,
        GEMINI_PREVIEW_TASKS
      ).registerOnWorkerServer(ws),
    "Google Gemini"
  );
}

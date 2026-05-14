/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { GEMINI_PREVIEW_TASKS, GEMINI_RUN_FNS } from "./common/Gemini_JobRunFns";
import { GoogleGeminiProvider } from "./GoogleGeminiProvider";

export async function registerGeminiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new GoogleGeminiProvider(GEMINI_RUN_FNS, GEMINI_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "Google Gemini"
  );
}

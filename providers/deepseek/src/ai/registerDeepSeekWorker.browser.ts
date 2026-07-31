/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { DEEPSEEK_PREVIEW_TASKS, DEEPSEEK_RUN_FNS } from "./common/DeepSeek_JobRunFns.browser";
import { DeepSeekProvider } from "./DeepSeekProvider";

export async function registerDeepSeekWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new DeepSeekProvider(DEEPSEEK_RUN_FNS, DEEPSEEK_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "DeepSeek"
  );
}

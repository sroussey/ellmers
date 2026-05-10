/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { LLAMACPP_PREVIEW_TASKS, LLAMACPP_RUN_FNS } from "./common/LlamaCpp_JobRunFns";
import { LlamaCppProvider } from "./LlamaCppProvider";

export async function registerLlamaCppWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new LlamaCppProvider(LLAMACPP_RUN_FNS, LLAMACPP_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "LlamaCpp"
  );
}

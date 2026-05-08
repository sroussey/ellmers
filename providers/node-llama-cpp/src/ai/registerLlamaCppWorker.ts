/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import {
  LLAMACPP_PREVIEW_TASKS,
  LLAMACPP_STREAM_TASKS,
  LLAMACPP_TASKS,
} from "./common/LlamaCpp_JobRunFns";
import { LlamaCppProvider } from "./LlamaCppProvider";

export async function registerLlamaCppWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new LlamaCppProvider(
        LLAMACPP_TASKS,
        LLAMACPP_STREAM_TASKS,
        LLAMACPP_PREVIEW_TASKS
      ).registerOnWorkerServer(ws),
    "LlamaCpp"
  );
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { XAI_PREVIEW_TASKS, XAI_RUN_FNS } from "./common/Xai_JobRunFns";
import { XaiProvider } from "./XaiProvider";

export async function registerXaiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new XaiProvider(XAI_RUN_FNS, XAI_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "xAI"
  );
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { CactusProvider } from "./CactusProvider.browser";
import { CACTUS_PREVIEW_TASKS, CACTUS_RUN_FNS } from "./common/Cactus_JobRunFns.browser";

export async function registerCactusWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new CactusProvider(CACTUS_RUN_FNS, CACTUS_PREVIEW_TASKS).registerOnWorkerServer(ws),
    "Cactus"
  );
}

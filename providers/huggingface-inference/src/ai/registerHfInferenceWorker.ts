/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { HFI_RUN_FNS } from "./common/HFI_JobRunFns";
import { HfInferenceProvider } from "./HfInferenceProvider";

export async function registerHfInferenceWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new HfInferenceProvider(HFI_RUN_FNS).registerOnWorkerServer(ws),
    "Hugging Face Inference"
  );
}

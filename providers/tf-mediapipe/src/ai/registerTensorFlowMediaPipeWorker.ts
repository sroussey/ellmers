/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { TFMP_RUN_FNS } from "./common/TFMP_JobRunFns";
import { TensorFlowMediaPipeProvider } from "./TensorFlowMediaPipeProvider";

export async function registerTensorFlowMediaPipeWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new TensorFlowMediaPipeProvider(TFMP_RUN_FNS).registerOnWorkerServer(ws),
    "TensorFlow MediaPipe"
  );
}

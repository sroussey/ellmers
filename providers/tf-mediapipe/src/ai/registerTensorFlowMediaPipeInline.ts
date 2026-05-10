/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { TFMP_RUN_FNS } from "./common/TFMP_JobRunFns";
import { TensorFlowMediaPipeQueuedProvider } from "./TensorFlowMediaPipeQueuedProvider";

export async function registerTensorFlowMediaPipeInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await registerProviderInline(
    new TensorFlowMediaPipeQueuedProvider(TFMP_RUN_FNS),
    "TensorFlow MediaPipe",
    options
  );
}

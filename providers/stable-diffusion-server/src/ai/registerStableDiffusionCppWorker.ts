/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import type { IStableDiffusionCppProviderOptions } from "./common/StableDiffusionCpp_Client";
import { buildStableDiffusionCppRunFns } from "./common/StableDiffusionCpp_JobRunFns";
import { StableDiffusionCppProvider } from "./StableDiffusionCppProvider";

/**
 * Worker-server-side registration. Supports both transport and externalUrl modes.
 * Transport is constructed inside this worker runtime by the caller and held
 * by closure in the run-fns. Primary production path.
 */
export async function registerStableDiffusionCppWorker(
  options: IStableDiffusionCppProviderOptions = {}
): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new StableDiffusionCppProvider(buildStableDiffusionCppRunFns(options)).registerOnWorkerServer(
        ws
      ),
    "StableDiffusionCpp"
  );
}

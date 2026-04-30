/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "../common/registerProvider";
import { HfInferenceQueuedProvider } from "./HfInferenceQueuedProvider";
import { registerHfImageValidator } from "./common/HFI_ImageValidation";

export async function registerHfInference(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  registerHfImageValidator();
  await registerProviderWithWorker(
    new HfInferenceQueuedProvider(),
    "Hugging Face Inference",
    options
  );
}

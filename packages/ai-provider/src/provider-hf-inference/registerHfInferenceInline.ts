/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "../common/registerProvider";
import { HFI_STREAM_TASKS, HFI_TASKS } from "./common/HFI_JobRunFns";
import { HfInferenceQueuedProvider } from "./HfInferenceQueuedProvider";
import { registerHfImageValidator } from "./common/HFI_ImageValidation";

export async function registerHfInferenceInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  registerHfImageValidator();
  await registerProviderInline(
    new HfInferenceQueuedProvider(HFI_TASKS, HFI_STREAM_TASKS),
    "Hugging Face Inference",
    options
  );
}

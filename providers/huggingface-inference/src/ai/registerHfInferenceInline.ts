/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { registerHfImageValidator } from "./common/HFI_ImageValidation";
import { HFI_RUN_FNS } from "./common/HFI_JobRunFns";
import { HfInferenceQueuedProvider } from "./HfInferenceQueuedProvider";

export async function registerHfInferenceInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  registerHfImageValidator();
  await registerProviderInline(
    new HfInferenceQueuedProvider(HFI_RUN_FNS),
    "Hugging Face Inference",
    options
  );
}

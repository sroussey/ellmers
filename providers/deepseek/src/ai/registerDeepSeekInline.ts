/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { DEEPSEEK_PREVIEW_TASKS, DEEPSEEK_RUN_FNS } from "./common/DeepSeek_JobRunFns";
import { DeepSeekQueuedProvider } from "./DeepSeekQueuedProvider";

export async function registerDeepSeekInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new DeepSeekQueuedProvider(DEEPSEEK_RUN_FNS, DEEPSEEK_PREVIEW_TASKS),
    "DeepSeek",
    options
  );
}

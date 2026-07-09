/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { XAI_PREVIEW_TASKS, XAI_RUN_FNS } from "./common/Xai_JobRunFns.browser";
import { XaiQueuedProvider } from "./XaiQueuedProvider";

export async function registerXaiInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new XaiQueuedProvider(XAI_RUN_FNS, XAI_PREVIEW_TASKS),
    "xAI",
    options
  );
}

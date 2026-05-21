/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { CactusQueuedProvider } from "./CactusQueuedProvider";
import { CACTUS_PREVIEW_TASKS, CACTUS_RUN_FNS } from "./common/Cactus_JobRunFns";

export async function registerCactusInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new CactusQueuedProvider(CACTUS_RUN_FNS, CACTUS_PREVIEW_TASKS),
    "Cactus",
    options
  );
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { AnthropicQueuedProvider } from "./AnthropicQueuedProvider";
import {
  ANTHROPIC_PREVIEW_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_TASKS,
} from "./common/Anthropic_JobRunFns";

export async function registerAnthropicInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new AnthropicQueuedProvider(ANTHROPIC_TASKS, ANTHROPIC_STREAM_TASKS, ANTHROPIC_PREVIEW_TASKS),
    "Anthropic",
    options
  );
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { type ILlamaCppServerProviderOptions } from "./common/LlamaCppServer_Client";
import { buildLlamaCppServerRunFns } from "./common/LlamaCppServer_JobRunFns";
import { LlamaCppServerQueuedProvider } from "./LlamaCppServerQueuedProvider";

export interface IRegisterLlamaCppServerInlineOptions
  extends AiProviderRegisterOptions, ILlamaCppServerProviderOptions {}

/** Main-thread inline registration. Supports transport mode. */
export async function registerLlamaCppServerInline(
  options: IRegisterLlamaCppServerInlineOptions = {}
): Promise<void> {
  const { transport, externalUrl, defaultCtx, ...registerOptions } = options;
  await registerProviderInline(
    new LlamaCppServerQueuedProvider(
      buildLlamaCppServerRunFns({ transport, externalUrl, defaultCtx })
    ),
    "LlamaCppServer",
    registerOptions
  );
}

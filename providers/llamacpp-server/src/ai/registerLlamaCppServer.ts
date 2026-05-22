/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import type { IBackendsTransport } from "@workglow/ai/provider-utils";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { LlamaCppServerProvider } from "./LlamaCppServerProvider";

export interface IRegisterLlamaCppServerOptions extends AiProviderRegisterOptions {
  readonly transport: IBackendsTransport;
  readonly externalUrl?: string;
  readonly defaultCtx?: number;
}

export async function registerLlamaCppServer(
  options: IRegisterLlamaCppServerOptions
): Promise<void> {
  const { transport, externalUrl, defaultCtx, ...registerOptions } = options;
  await registerProviderInline(
    new LlamaCppServerProvider({ transport, externalUrl, defaultCtx }),
    "LlamaCppServer",
    registerOptions
  );
}

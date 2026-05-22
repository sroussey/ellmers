/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import type { IBackendsTransport } from "@workglow/ai/provider-utils";
import { StableDiffusionCppProvider } from "./StableDiffusionCppProvider";

export interface IRegisterStableDiffusionCppOptions extends AiProviderRegisterOptions {
  readonly transport: IBackendsTransport;
  readonly externalUrl?: string;
}

export async function registerStableDiffusionCpp(
  options: IRegisterStableDiffusionCppOptions
): Promise<void> {
  const { transport, externalUrl, ...registerOptions } = options;
  await registerProviderInline(
    new StableDiffusionCppProvider({ transport, externalUrl }),
    "StableDiffusionCpp",
    registerOptions
  );
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import type { IBackendsTransport } from "@workglow/ai/provider-utils";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import type { StableDiffusionCppEndpoint } from "./StableDiffusionCppProvider";
import { StableDiffusionCppProvider } from "./StableDiffusionCppProvider";

export interface IRegisterStableDiffusionCppOptions extends AiProviderRegisterOptions {
  readonly transport: IBackendsTransport;
  readonly externalUrl?: string;
  readonly endpoint?: StableDiffusionCppEndpoint;
}

export async function registerStableDiffusionCpp(
  options: IRegisterStableDiffusionCppOptions
): Promise<void> {
  const { transport, externalUrl, endpoint, ...registerOptions } = options;
  await registerProviderInline(
    new StableDiffusionCppProvider({ transport, externalUrl, endpoint }),
    "StableDiffusionCpp",
    registerOptions
  );
}

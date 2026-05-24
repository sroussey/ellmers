/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { type IStableDiffusionCppProviderOptions } from "./common/StableDiffusionCpp_Client";
import { buildStableDiffusionCppRunFns } from "./common/StableDiffusionCpp_JobRunFns";
import { StableDiffusionCppQueuedProvider } from "./StableDiffusionCppQueuedProvider";

export interface IRegisterStableDiffusionCppInlineOptions
  extends AiProviderRegisterOptions, IStableDiffusionCppProviderOptions {}

/** Main-thread inline registration. Supports transport mode. */
export async function registerStableDiffusionCppInline(
  options: IRegisterStableDiffusionCppInlineOptions = {}
): Promise<void> {
  const { transport, externalUrl, endpoint, ...registerOptions } = options;
  await registerProviderInline(
    new StableDiffusionCppQueuedProvider(
      buildStableDiffusionCppRunFns({ transport, externalUrl, endpoint })
    ),
    "StableDiffusionCpp",
    registerOptions
  );
}

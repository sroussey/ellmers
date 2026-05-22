/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { MlxProvider } from "./MlxProvider";

export type IRegisterMlxOptions = AiProviderRegisterOptions;

export async function registerMlx(options: IRegisterMlxOptions): Promise<void> {
  await registerProviderInline(new MlxProvider(), "Mlx", options);
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { getLogger } from "@workglow/util/worker";
import { MlxProvider } from "./MlxProvider";

export type IRegisterMlxOptions = AiProviderRegisterOptions;

/**
 * Registers the MLX provider when the host can actually run it. Today
 * {@link MlxProvider.isAvailable} is always `false`, so this warns and returns
 * without touching the registry — callers must treat a missing `LOCAL_MLX`
 * provider as the expected outcome.
 */
export async function registerMlx(options: IRegisterMlxOptions = {}): Promise<void> {
  const provider = new MlxProvider();
  if (!(await provider.isAvailable())) {
    getLogger().warn(
      "MLX provider not registered: the mlx-lm Python runtime is not bundled. MLX models will not be offered."
    );
    return;
  }
  await registerProviderInline(provider, "Mlx", options);
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import {
  acquireBaseUrl,
  buildServerUrl,
  type IStableDiffusionCppProviderOptions,
} from "./StableDiffusionCpp_Client";
import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";
import { getStableDiffusionCppModelName } from "./StableDiffusionCpp_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

export function createStableDiffusionCppModelInfoRunFn(
  opts: IStableDiffusionCppProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<ModelInfoTaskInput, ModelInfoTaskOutput, StableDiffusionCppModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    let is_loaded = false;
    const expectedName = getStableDiffusionCppModelName(model);

    try {
      const { baseUrl, release } = await acquire(model, opts);
      try {
        const res = await fetch(buildServerUrl(baseUrl, "/v1/models"), { signal });
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id?: string }> };
          is_loaded = !!body.data?.some((m) => m.id === expectedName);
        }
      } finally {
        await release();
      }
    } catch {
      // Server unreachable or /v1/models not implemented — leave is_loaded false.
    }

    emit({
      type: "finish",
      data: {
        model: input.model,
        is_local: true,
        is_remote: false,
        supports_browser: true,
        supports_node: true,
        is_cached: false,
        is_loaded,
        file_sizes: null,
      },
    });
  };
}

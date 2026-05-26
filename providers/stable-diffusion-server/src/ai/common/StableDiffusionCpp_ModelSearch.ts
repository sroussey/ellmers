/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelSearchTaskInput, ModelSearchTaskOutput } from "@workglow/ai";
import { filterModelSearchResultsByQuery, localOnlyFetch } from "@workglow/ai/provider-utils";
import {
  buildServerUrl,
  normalizeServerBaseUrl,
  type IStableDiffusionCppProviderOptions,
} from "./StableDiffusionCpp_Client";
import { LOCAL_STABLE_DIFFUSION_CPP } from "./StableDiffusionCpp_Constants";
import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";

export function createStableDiffusionCppModelSearchRunFn(
  opts: IStableDiffusionCppProviderOptions
): AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput, StableDiffusionCppModelConfig> {
  return async (input, _model, signal, emit) => {
    signal?.throwIfAborted?.();
    if (!opts.externalUrl) {
      emit({ type: "finish", data: { results: [] } });
      return;
    }
    try {
      const baseUrl = normalizeServerBaseUrl(opts.externalUrl);
      const res = await localOnlyFetch(
        buildServerUrl(baseUrl, "/v1/models"),
        { signal },
        "StableDiffusionCpp"
      );
      if (!res.ok) {
        emit({ type: "finish", data: { results: [] } });
        return;
      }
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const results = (body.data ?? []).map((m) => ({
        id: m.id,
        label: m.id,
        description: m.id,
        record: {
          model_id: m.id,
          provider: LOCAL_STABLE_DIFFUSION_CPP,
          title: m.id,
          description: "",
          capabilities: [],
          provider_config: { model_name: m.id, base_url: baseUrl },
          metadata: {},
        },
        raw: m,
      }));
      emit({
        type: "finish",
        data: { results: filterModelSearchResultsByQuery(results, input.query) },
      });
    } catch {
      emit({ type: "finish", data: { results: [] } });
    }
  };
}

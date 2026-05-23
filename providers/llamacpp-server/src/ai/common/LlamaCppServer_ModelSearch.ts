/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelSearchTaskInput, ModelSearchTaskOutput } from "@workglow/ai";
import { filterModelSearchResultsByQuery } from "@workglow/ai/provider-utils";
import type { ILlamaCppServerProviderOptions } from "./LlamaCppServer_Client";
import { LOCAL_LLAMACPP_SERVER } from "./LlamaCppServer_Constants";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";

/**
 * Returns the single loaded model when the provider has a usable external URL
 * (provider-level `externalUrl`). Otherwise returns `[]` — transport mode
 * cannot search because `transport.ensureRunning` itself requires a model path.
 */
export function createLlamaCppServerModelSearchStream(
  opts: ILlamaCppServerProviderOptions
): AiProviderRunFn<ModelSearchTaskInput, ModelSearchTaskOutput, LlamaCppServerModelConfig> {
  return async (input, _model, signal, emit) => {
    signal?.throwIfAborted?.();
    if (!opts.externalUrl) {
      emit({ type: "finish", data: { results: [] } });
      return;
    }
    const baseUrl = opts.externalUrl.replace(/\/+$/, "");
    try {
      const res = await fetch(`${baseUrl}/v1/models`, { signal });
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
          provider: LOCAL_LLAMACPP_SERVER,
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

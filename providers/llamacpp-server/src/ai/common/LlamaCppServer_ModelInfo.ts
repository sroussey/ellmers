/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { localOnlyFetch } from "@workglow/ai/provider-utils";
import {
  acquireBaseUrl,
  buildServerUrl,
  type ILlamaCppServerProviderOptions,
} from "./LlamaCppServer_Client";
import type { LlamaCppServerModelConfig } from "./LlamaCppServer_ModelSchema";
import { getLlamaCppServerModelName } from "./LlamaCppServer_ModelUtil";

type AcquireFn = typeof acquireBaseUrl;

export function createLlamaCppServerModelInfoStream(
  opts: ILlamaCppServerProviderOptions,
  acquire: AcquireFn = acquireBaseUrl
): AiProviderRunFn<ModelInfoTaskInput, ModelInfoTaskOutput, LlamaCppServerModelConfig> {
  return async (input, model, signal, emit) => {
    signal?.throwIfAborted?.();
    const pc = model?.provider_config;

    if (input.detail === "dimensions") {
      let native_dimensions =
        typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
      if (native_dimensions === undefined) {
        try {
          const { baseUrl, release } = await acquire(model, opts);
          try {
            const res = await localOnlyFetch(
              buildServerUrl(baseUrl, "/props"),
              { signal },
              "LlamaCppServer"
            );
            if (res.ok) {
              const props = (await res.json()) as {
                default_generation_settings?: { n_embd?: number };
              };
              const n = props.default_generation_settings?.n_embd;
              if (typeof n === "number") native_dimensions = n;
            }
          } finally {
            await release();
          }
        } catch {
          // Leave unset — caller handles missing dimensions.
        }
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
          is_loaded: false,
          file_sizes: null,
          ...(native_dimensions !== undefined ? { native_dimensions } : {}),
        } as ModelInfoTaskOutput,
      });
      return;
    }

    // General info — try /v1/models. is_loaded = the server reports this model name.
    let is_loaded = false;
    const expectedName = getLlamaCppServerModelName(model);
    try {
      const { baseUrl, release } = await acquire(model, opts);
      try {
        const res = await localOnlyFetch(
          buildServerUrl(baseUrl, "/v1/models"),
          { signal },
          "LlamaCppServer"
        );
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id?: string }> };
          is_loaded = !!body.data?.some((m) => m.id === expectedName);
        }
      } finally {
        await release();
      }
    } catch {
      // Server unreachable — leave is_loaded false.
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

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { resolveApiKey } from "@workglow/ai/provider-utils";
import { HF_INFERENCE } from "./HFI_Constants";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

const HF_API_BASE = "https://huggingface.co/api";

/** Characters the Hub allows in a namespace or repo name. */
const HF_REPO_SEGMENT = /^[\w.-]+$/;

/** `.` and `..` pass the charset test but would traverse out of `/api/models`. */
function isValidSegment(segment: string): boolean {
  return HF_REPO_SEGMENT.test(segment) && segment !== "." && segment !== "..";
}

/**
 * Build the `{namespace}/{name}` path for a Hub model id. The slash separating
 * the two segments is a path separator, so the id is encoded per segment: a
 * whole-id `encodeURIComponent` turns it into `%2F` and the Hub answers 400.
 * Each segment is still encoded even though the validated charset needs no
 * escaping — that stays correct if the accepted charset ever widens.
 */
function hfModelPath(modelName: string): string {
  const segments = modelName.split("/");
  if (segments.length > 2 || !segments.every(isValidSegment)) {
    throw new Error(`${HF_INFERENCE} model "${modelName}" is not a valid Hugging Face repo id`);
  }
  return segments.map(encodeURIComponent).join("/");
}

function modelNameOf(model: HfInferenceModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function apiKeyOf(model: HfInferenceModelConfig | undefined): string | undefined {
  const config = model?.provider_config as
    | { credential_key?: string; api_key?: string }
    | undefined;
  try {
    return resolveApiKey({
      config,
      envVar: "HF_TOKEN",
      providerLabel: "Hugging Face Inference",
    });
  } catch {
    // Hub model lookup works without a token for public models; generation
    // still requires a key elsewhere.
    return config?.api_key ?? config?.credential_key;
  }
}

/**
 * Confirm the model id exists on the Hugging Face Hub via GET /api/models/{id}.
 * Does not use curated fallback lists.
 */
async function assertHfModelExists(
  model: HfInferenceModelConfig | undefined,
  signal: AbortSignal | undefined
): Promise<string> {
  const modelName = modelNameOf(model);
  const token = apiKeyOf(model);
  const res = await fetch(`${HF_API_BASE}/models/${hfModelPath(modelName)}`, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.status === 404) {
    throw new Error(
      `${HF_INFERENCE} model "${modelName}" was not found (provider API returned not found)`
    );
  }
  // A 4xx that is not 404 is the request being rejected, not the model missing;
  // reporting it as a lookup failure hides a malformed request.
  if (res.status >= 400 && res.status < 500) {
    throw new Error(
      `${HF_INFERENCE} model "${modelName}" lookup was rejected by the Hugging Face API (${res.status})`
    );
  }
  if (!res.ok) {
    throw new Error(
      `${HF_INFERENCE} model "${modelName}" lookup failed (HuggingFace API returned ${res.status})`
    );
  }
  return modelName;
}

function remoteInfoBase(input: ModelInfoTaskInput): ModelInfoTaskOutput {
  return {
    model: input.model,
    is_local: false,
    is_remote: true,
    supports_browser: true,
    supports_node: true,
    is_cached: false,
    is_loaded: false,
    file_sizes: null,
  };
}

/**
 * One-shot run-fn for `["model.info"]`. Verifies the model exists on the
 * Hugging Face Hub, then emits a remote info record. When `detail` is
 * `"dimensions"`, attaches provider_config dimensions after the check.
 */
export const HFI_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  HfInferenceModelConfig
> = async (input, model, signal, emit) => {
  await assertHfModelExists(model, signal);
  const base = remoteInfoBase(input);

  if (input.detail === "dimensions") {
    const pc = model?.provider_config as Record<string, unknown>;
    const native_dimensions =
      typeof pc?.native_dimensions === "number" ? pc.native_dimensions : undefined;
    const mrl = typeof pc?.mrl === "boolean" ? pc.mrl : false;
    emit({
      type: "finish",
      data: {
        ...base,
        ...(native_dimensions !== undefined ? { native_dimensions } : {}),
        ...(mrl ? { mrl } : {}),
      },
    });
    return;
  }

  emit({ type: "finish", data: base });
};

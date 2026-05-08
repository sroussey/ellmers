/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveApiKey } from "@workglow/ai/provider-utils";
import type { InferenceProviderOrPolicy } from "@huggingface/inference";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

let _sdk: typeof import("@huggingface/inference") | undefined;

export async function loadHfInferenceSDK() {
  if (_sdk) return _sdk;
  try {
    _sdk = (await import(
      /* @vite-ignore */ "@huggingface/inference"
    )) as typeof import("@huggingface/inference");
  } catch {
    throw new Error(
      "@huggingface/inference is required for Hugging Face Inference tasks. Install it with: bun add @huggingface/inference"
    );
  }
  return _sdk!;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly provider?: string;
}

export async function getClient(model: HfInferenceModelConfig | undefined) {
  const sdk = await loadHfInferenceSDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey = resolveApiKey({
    config,
    envVar: "HF_TOKEN",
    providerLabel: "Hugging Face",
  });
  try {
    return new sdk.InferenceClient(apiKey);
  } catch (err) {
    throw new Error(
      `Failed to create HuggingFace Inference client: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

export function getModelName(model: HfInferenceModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

export function getProvider(
  model: HfInferenceModelConfig | undefined
): InferenceProviderOrPolicy | undefined {
  return model?.provider_config?.provider as InferenceProviderOrPolicy | undefined;
}

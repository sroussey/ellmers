/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLike, loadProviderSdk, resolveApiKey } from "@workglow/ai-provider/common";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

let _sdk: typeof import("@anthropic-ai/sdk") | undefined;

export async function loadAnthropicSDK() {
  if (!_sdk) {
    _sdk = await loadProviderSdk<typeof import("@anthropic-ai/sdk")>(
      "@anthropic-ai/sdk",
      "Anthropic"
    );
  }
  return _sdk.default;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly max_tokens?: number;
}

export async function getClient(model: AnthropicModelConfig | undefined) {
  const Anthropic = await loadAnthropicSDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey = resolveApiKey({
    config,
    envVar: "ANTHROPIC_API_KEY",
    providerLabel: "Anthropic",
  });
  try {
    return new Anthropic({
      apiKey,
      baseURL: config?.base_url || undefined,
      dangerouslyAllowBrowser: isBrowserLike(),
    });
  } catch (err) {
    throw new Error(
      `Failed to create Anthropic client: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

export function getModelName(model: AnthropicModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

export function getMaxTokens(
  input: { maxTokens?: number },
  model: AnthropicModelConfig | undefined
): number {
  return input.maxTokens ?? model?.provider_config?.max_tokens ?? 1024;
}

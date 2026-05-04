/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _OpenAIClass: (new (config: any) => any) | undefined;

export async function loadOpenAISDK() {
  if (!_OpenAIClass) {
    try {
      const sdk = await import("openai");
      _OpenAIClass = sdk.default;
    } catch {
      throw new Error("openai is required for OpenAI tasks. Install it with: bun add openai");
    }
  }
  return _OpenAIClass;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly organization?: string;
}

export async function getClient(model: OpenAiModelConfig | undefined) {
  const OpenAI = await loadOpenAISDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey =
    config?.credential_key ||
    config?.api_key ||
    (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API key: set provider_config.credential_key or the OPENAI_API_KEY environment variable."
    );
  }
  try {
    return new OpenAI({
      apiKey,
      baseURL: config?.base_url || undefined,
      organization: config?.organization || undefined,
      dangerouslyAllowBrowser:
        typeof globalThis.document !== "undefined" || "WorkerGlobalScope" in globalThis,
    });
  } catch (err) {
    throw new Error(
      `Failed to create OpenAI client: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

export function getModelName(model: OpenAiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

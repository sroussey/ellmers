/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLike, resolveApiKey } from "@workglow/ai/provider-utils";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _OpenAIClass: (new (config: any) => any) | undefined;

export async function loadOpenAISDK() {
  if (_OpenAIClass) return _OpenAIClass;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _OpenAIClass = ((await import(/* @vite-ignore */ "openai")) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      default: new (config: any) => any;
    }).default;
  } catch {
    throw new Error("openai is required for OpenAI tasks. Install it with: bun add openai");
  }
  return _OpenAIClass!;
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
  const apiKey = resolveApiKey({
    config,
    envVar: "OPENAI_API_KEY",
    providerLabel: "OpenAI",
  });
  try {
    return new OpenAI({
      apiKey,
      baseURL: config?.base_url || undefined,
      organization: config?.organization || undefined,
      dangerouslyAllowBrowser: isBrowserLike(),
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

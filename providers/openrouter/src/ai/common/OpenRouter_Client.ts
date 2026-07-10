/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLike, resolveApiKey, validateProviderBaseUrl } from "@workglow/ai/provider-utils";
import type { OpenRouterModelConfig } from "./OpenRouter_ModelSchema";

/** Hostnames accepted for the OpenRouter `base_url` without `trustedBaseUrl`. */
export const OPENROUTER_ALLOWED_HOSTS: readonly string[] = ["openrouter.ai"];

type OpenAIClientClass = new (config: any) => any;

let _loadPromise: Promise<OpenAIClientClass> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadOpenAISDK(): Promise<OpenAIClientClass> {
  _loadPromise ??= import(/* @vite-ignore */ "openai")

    .then((mod) => mod.default as OpenAIClientClass)
    .catch(() => {
      _loadPromise = undefined;
      throw new Error("openai is required for OpenRouter tasks. Install it with: bun add openai");
    });
  return _loadPromise;
}

/** Resolved shape of `provider_config` consumed by the client and request builder. */
export interface OpenRouterProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly trustedBaseUrl?: boolean;
  readonly provider_routing?: Record<string, unknown>;
  readonly reasoning?: Record<string, unknown>;
  readonly web_search?: boolean | Record<string, unknown>;
  readonly app_referer?: string;
  readonly app_title?: string;
}

export async function getClient(model: OpenRouterModelConfig | undefined) {
  const OpenAI = await loadOpenAISDK();
  const config = model?.provider_config as OpenRouterProviderConfig | undefined;
  const apiKey = resolveApiKey({
    config,
    envVar: "OPENROUTER_API_KEY",
    providerLabel: "OpenRouter",
  });
  // Validate before SDK construction so the API key is never attached to a
  // rejected host.
  const baseURL =
    validateProviderBaseUrl(config?.base_url, {
      vendor: "openai",
      allowHosts: OPENROUTER_ALLOWED_HOSTS,
      trustedBaseUrl: config?.trustedBaseUrl,
      providerLabel: "OpenRouter",
    }) ?? "https://openrouter.ai/api/v1";

  const defaultHeaders: Record<string, string> = {};
  if (config?.app_referer) defaultHeaders["HTTP-Referer"] = config.app_referer;
  if (config?.app_title) defaultHeaders["X-Title"] = config.app_title;

  try {
    return new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders,
      dangerouslyAllowBrowser: isBrowserLike(),
    });
  } catch (err) {
    throw new Error(
      `Failed to create OpenRouter client: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

export function getModelName(model: OpenRouterModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

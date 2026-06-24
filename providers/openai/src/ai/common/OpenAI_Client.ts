/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLike, resolveApiKey, validateProviderBaseUrl } from "@workglow/ai/provider-utils";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

/**
 * Hostnames (or hostname suffixes) accepted for OpenAI `base_url` without
 * the explicit `trustedBaseUrl` opt-out. Includes Azure OpenAI tenants.
 */
export const OPENAI_ALLOWED_HOSTS: readonly string[] = ["api.openai.com", ".openai.azure.com"];

type OpenAIClientClass = new (config: any) => any;

let _loadPromise: Promise<OpenAIClientClass> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadOpenAISDK(): Promise<OpenAIClientClass> {
  _loadPromise ??= import(/* @vite-ignore */ "openai")

    .then((mod) => mod.default as OpenAIClientClass)
    .catch(() => {
      _loadPromise = undefined;
      throw new Error("openai is required for OpenAI tasks. Install it with: bun add openai");
    });
  return _loadPromise;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly organization?: string;
  /**
   * When `true`, accept the `base_url` even if its hostname is not in
   * {@link OPENAI_ALLOWED_HOSTS}. Use only for known-good custom enterprise
   * gateways. The URL still has to parse and use a safe scheme.
   */
  readonly trustedBaseUrl?: boolean;
}

export async function getClient(model: OpenAiModelConfig | undefined) {
  const OpenAI = await loadOpenAISDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey = resolveApiKey({
    config,
    envVar: "OPENAI_API_KEY",
    providerLabel: "OpenAI",
  });
  // Throw before SDK construction on a rejected base_url so the API key is
  // never sent to an unvalidated host.
  const baseURL = validateProviderBaseUrl(config?.base_url, {
    vendor: "openai",
    allowHosts: OPENAI_ALLOWED_HOSTS,
    trustedBaseUrl: config?.trustedBaseUrl,
    providerLabel: "OpenAI",
  });
  try {
    return new OpenAI({
      apiKey,
      baseURL,
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

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
  readonly prompt_cache_key?: string;
  readonly reasoning?: { readonly effort?: string; readonly mode?: string };
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

/**
 * Resolves the configured `reasoning` object for reasoning-capable models
 * (the GPT-5.6 sol/terra/luna family and the o-series), sent verbatim as the
 * Responses `reasoning` parameter. Returns `undefined` when unset so
 * non-reasoning models and callers that don't opt in send no reasoning field.
 */
export function getReasoningConfig(
  model: OpenAiModelConfig | undefined
): { effort?: string; mode?: string } | undefined {
  const reasoning = (model?.provider_config as ResolvedProviderConfig | undefined)?.reasoning;
  if (!reasoning || (reasoning.effort === undefined && reasoning.mode === undefined)) {
    return undefined;
  }
  return reasoning;
}

/** Deterministic 32-bit FNV-1a hash → 8-char hex. Worker-safe (no crypto import). */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Resolves the Responses `prompt_cache_key`. Uses an explicit
 * `provider_config.prompt_cache_key` override when set, otherwise derives a
 * stable key from the request's cache-relevant prefix (model + system
 * instructions + tools) so requests sharing that prefix converge on one key and
 * hit the cache. GPT-5.6 bills cache writes, so a stable key (not a random one)
 * is the cost-correct default.
 */
export function resolvePromptCacheKey(
  model: OpenAiModelConfig | undefined,
  params: { model?: unknown; instructions?: unknown; tools?: unknown }
): string {
  const override = (model?.provider_config as ResolvedProviderConfig | undefined)?.prompt_cache_key;
  if (override) return override;
  const material = JSON.stringify([
    params.model ?? "",
    params.instructions ?? "",
    params.tools ?? null,
  ]);
  return `wg-${fnv1aHex(material)}`;
}

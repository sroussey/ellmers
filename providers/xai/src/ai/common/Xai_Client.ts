/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLike, resolveApiKey, validateProviderBaseUrl } from "@workglow/ai/provider-utils";
import { isModelEffort, type ModelEffort } from "@workglow/ai/worker";
import type { XaiModelConfig } from "./Xai_ModelSchema";

/** Default base URL for the xAI (Grok) OpenAI-compatible API. */
export const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";

/**
 * Hostnames (or hostname suffixes) accepted for xAI `base_url` without the
 * explicit `trustedBaseUrl` opt-out.
 */
export const XAI_ALLOWED_HOSTS: readonly string[] = ["api.x.ai"];

type OpenAIClientClass = new (config: any) => any;

let _loadPromise: Promise<OpenAIClientClass> | undefined;

// xAI is OpenAI wire-compatible, so we reuse the `openai` SDK. Keep the direct
// string-literal import so bundlers (vite) can resolve it statically.
export async function loadOpenAISDK(): Promise<OpenAIClientClass> {
  _loadPromise ??= import(/* @vite-ignore */ "openai")

    .then((mod) => mod.default as OpenAIClientClass)
    .catch(() => {
      _loadPromise = undefined;
      throw new Error("openai is required for xAI tasks. Install it with: bun add openai");
    });
  return _loadPromise;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  /**
   * When `true`, accept the `base_url` even if its hostname is not in
   * {@link XAI_ALLOWED_HOSTS}. Use only for known-good custom gateways. The
   * URL still has to parse and use a safe scheme.
   */
  readonly trustedBaseUrl?: boolean;
}

let _testClient: unknown;

/**
 * Override the client returned by {@link getClient} so runtime tests can
 * exercise run-fns without a live SDK, API key, or network call. Pass
 * `undefined` to restore normal SDK-backed creation.
 */
function setXaiClientForTests(client: unknown): void {
  _testClient = client;
}

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the
 * stable public API. Surfaced on the `ai-runtime` barrel (via `export *`) and
 * merged into the `/ai` barrel's `_testOnly`.
 */
export const _testOnly = {
  setXaiClientForTests,
} as const;

export async function getClient(model: XaiModelConfig | undefined) {
  if (_testClient) return _testClient as InstanceType<OpenAIClientClass>;
  const OpenAI = await loadOpenAISDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey = resolveApiKey({
    config,
    envVar: "XAI_API_KEY",
    providerLabel: "xAI",
  });
  // Throw before SDK construction on a rejected base_url so the API key is
  // never sent to an unvalidated host.
  const baseURL =
    validateProviderBaseUrl(config?.base_url, {
      vendor: "xai",
      allowHosts: XAI_ALLOWED_HOSTS,
      trustedBaseUrl: config?.trustedBaseUrl,
      providerLabel: "xAI",
    }) ?? XAI_DEFAULT_BASE_URL;
  try {
    return new OpenAI({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: isBrowserLike(),
    });
  } catch (err) {
    throw new Error(
      `Failed to create xAI client: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

export function getModelName(model: XaiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

const EFFORT_TO_XAI: Record<ModelEffort, string> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  extra: "high",
  ultra: "high",
};

/**
 * Native `provider_config.reasoning_effort` wins over coarse `model.effort`.
 * Extra/ultra collapse to xAI's highest documented value (`high`).
 */
export function getXaiReasoningEffort(model: XaiModelConfig | undefined): string | undefined {
  const native = (model?.provider_config as { reasoning_effort?: unknown } | undefined)
    ?.reasoning_effort;
  if (typeof native === "string") return native;
  if (model && isModelEffort(model.effort)) return EFFORT_TO_XAI[model.effort];
  return undefined;
}

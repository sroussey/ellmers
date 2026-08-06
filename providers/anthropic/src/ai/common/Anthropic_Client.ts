/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBrowserLike, resolveApiKey, validateProviderBaseUrl } from "@workglow/ai/provider-utils";
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "./Anthropic_Constants";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

/**
 * Hostnames (or hostname suffixes) accepted for Anthropic `base_url` without
 * the explicit `trustedBaseUrl` opt-out.
 */
export const ANTHROPIC_ALLOWED_HOSTS: readonly string[] = ["api.anthropic.com"];

type AnthropicSDKModule = typeof import("@anthropic-ai/sdk");
type AnthropicClientClass = AnthropicSDKModule["default"];

let _loadPromise: Promise<AnthropicClientClass> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadAnthropicSDK(): Promise<AnthropicClientClass> {
  _loadPromise ??= import("@anthropic-ai/sdk")
    .then((mod) => mod.default)
    .catch(() => {
      _loadPromise = undefined;
      throw new Error(
        "@anthropic-ai/sdk is required for Anthropic tasks. Install it with: bun add @anthropic-ai/sdk"
      );
    });
  return _loadPromise;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly max_tokens?: number;
  /**
   * When `true`, accept the `base_url` even if its hostname is not in
   * {@link ANTHROPIC_ALLOWED_HOSTS}. Use only for known-good custom
   * enterprise gateways. The URL still has to parse and use a safe scheme.
   */
  readonly trustedBaseUrl?: boolean;
}

let _testClient: unknown;

/**
 * Override the client returned by {@link getClient} so runtime tests can
 * capture the requests the Anthropic run-fns build without a live SDK,
 * API key, or network call. Pass `undefined` to restore normal SDK-backed
 * creation. This lives in the runtime module (not a `vi.mock` of
 * `@anthropic-ai/sdk`) so it works identically whether the provider resolves
 * to `src` or the bundled `dist`, and is immune to duplicate SDK copies
 * across the workspace defeating module-level mocks.
 */
function setAnthropicClientForTests(client: unknown): void {
  _testClient = client;
}

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the
 * stable public API. Surfaced on the `ai-runtime` barrel (via `export *`) and
 * merged into the `/ai` barrel's `_testOnly`.
 */
export const _testOnly = {
  setAnthropicClientForTests,
} as const;

export async function getClient(model: AnthropicModelConfig | undefined) {
  if (_testClient) return _testClient as InstanceType<AnthropicClientClass>;
  const Anthropic = await loadAnthropicSDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey = resolveApiKey({
    config,
    envVar: "ANTHROPIC_API_KEY",
    providerLabel: "Anthropic",
  });
  // Throw before SDK construction on a rejected base_url so the API key is
  // never sent to an unvalidated host.
  const baseURL = validateProviderBaseUrl(config?.base_url, {
    vendor: "anthropic",
    allowHosts: ANTHROPIC_ALLOWED_HOSTS,
    trustedBaseUrl: config?.trustedBaseUrl,
    providerLabel: "Anthropic",
  });
  try {
    return new Anthropic({
      apiKey,
      baseURL,
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

/**
 * `input` is widened to `object` so every run-fn can hand its own task input
 * through, including the ones whose schema declares no `maxTokens` port. Those
 * simply fall through to the configured default.
 */
export function getMaxTokens(input: object, model: AnthropicModelConfig | undefined): number {
  const requested = (input as { maxTokens?: number }).maxTokens;
  return requested ?? model?.provider_config?.max_tokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
}

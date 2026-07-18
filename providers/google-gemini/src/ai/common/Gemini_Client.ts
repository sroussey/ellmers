/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GoogleGenAI } from "@google/genai";
import { resolveApiKey } from "@workglow/ai/provider-utils";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

type GeminiSDKModule = typeof import("@google/genai");
type GoogleGenAIConstructor = GeminiSDKModule["GoogleGenAI"];

let _loadPromise: Promise<GoogleGenAIConstructor> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadGeminiSDK(): Promise<GoogleGenAIConstructor> {
  _loadPromise ??= import("@google/genai")
    .then((mod) => mod.GoogleGenAI)
    .catch(() => {
      _loadPromise = undefined;
      throw new Error(
        "@google/genai is required for Gemini tasks. Install it with: bun add @google/genai"
      );
    });
  return _loadPromise;
}

const _clientByKey = new Map<string, Promise<GoogleGenAI>>();

let _testClient: GoogleGenAI | undefined;

/**
 * Override the client returned by {@link createGeminiClient} so runtime tests
 * can capture the requests the Gemini run-fns build without a live SDK or
 * network call. Pass `undefined` to restore normal SDK-backed creation. Also
 * clears the per-key client cache so a previously memoized real client is not
 * reused across the override boundary.
 *
 * This lives in the runtime module (not a `vi.mock` of `@google/genai`) so it
 * works identically whether the provider resolves to `src` or the bundled
 * `dist`, and is immune to duplicate `@google/genai` copies across the
 * workspace defeating module-level mocks.
 */
function setGeminiClientForTests(client: GoogleGenAI | undefined): void {
  _testClient = client;
  _clientByKey.clear();
}

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the
 * stable public API. Surfaced on the `ai-runtime` barrel (via `export *`) and
 * merged into the `/ai` barrel's `_testOnly`.
 */
export const _testOnly = {
  setGeminiClientForTests,
} as const;

/**
 * Load the SDK and return a client bound to the resolved API key. The
 * `@google/genai` `GoogleGenAI` facade stands up auth wiring and several
 * sub-service objects, so it is memoized per API key rather than rebuilt on
 * every run-fn invocation. The in-flight promise is cached (set synchronously
 * before the first await) so concurrent calls for the same key share one client
 * instead of racing to construct duplicates; a failed load evicts the entry so
 * the next call can retry.
 */
export function createGeminiClient(model: GeminiModelConfig | undefined): Promise<GoogleGenAI> {
  if (_testClient) return Promise.resolve(_testClient);
  const apiKey = getApiKey(model);
  let clientPromise = _clientByKey.get(apiKey);
  if (!clientPromise) {
    clientPromise = loadGeminiSDK()
      .then((GoogleGenAICtor) => new GoogleGenAICtor({ apiKey }))
      .catch((err) => {
        _clientByKey.delete(apiKey);
        throw err;
      });
    _clientByKey.set(apiKey, clientPromise);
  }
  return clientPromise;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly embedding_task_type?: string | null;
}

export function getApiKey(model: GeminiModelConfig | undefined): string {
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  return resolveApiKey({
    config,
    envVar: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    providerLabel: "Google",
  });
}

export function getModelName(model: GeminiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

/**
 * Reasoning-token budget for thinking models, sourced from the model's
 * `provider_config.thinking_budget`. Returns `undefined` when unset so callers
 * can decide whether to apply a task-specific default.
 */
export function getThinkingBudget(model: GeminiModelConfig | undefined): number | undefined {
  const budget = model?.provider_config?.thinking_budget;
  return typeof budget === "number" ? budget : undefined;
}

/**
 * Resolves the thinking-related request fields consistently across run-fns.
 * Gemini counts thinking tokens against `maxOutputTokens`, so a positive budget
 * is added on top of the caller's cap to leave room for the visible answer.
 *
 * @param defaultBudget applied when the model has no configured budget. Pass a
 *   value for tasks that always need bounded reasoning (structured generation);
 *   omit it for tasks that should inherit the model's own default thinking
 *   (plain generation, tool calling) and only opt in when explicitly configured.
 */
export function resolveThinkingConfig(
  model: GeminiModelConfig | undefined,
  maxTokens: number | undefined,
  defaultBudget?: number
): {
  thinkingConfig: { thinkingBudget: number } | undefined;
  maxOutputTokens: number | undefined;
} {
  const budget = getThinkingBudget(model) ?? defaultBudget;
  if (budget === undefined) {
    return { thinkingConfig: undefined, maxOutputTokens: maxTokens };
  }
  const maxOutputTokens = maxTokens !== undefined && budget > 0 ? maxTokens + budget : maxTokens;
  return { thinkingConfig: { thinkingBudget: budget }, maxOutputTokens };
}

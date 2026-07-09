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

/** Load the SDK and construct a client bound to the resolved API key. */
export async function createGeminiClient(
  model: GeminiModelConfig | undefined
): Promise<GoogleGenAI> {
  const GoogleGenAICtor = await loadGeminiSDK();
  return new GoogleGenAICtor({ apiKey: getApiKey(model) });
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

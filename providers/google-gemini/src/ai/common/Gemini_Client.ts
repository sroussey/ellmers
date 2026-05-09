/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveApiKey } from "@workglow/ai/provider-utils";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

type GeminiSDKModule = typeof import("@google/generative-ai");
type GoogleGenerativeAIConstructor = GeminiSDKModule["GoogleGenerativeAI"];

let _loadPromise: Promise<GoogleGenerativeAIConstructor> | undefined;

// NOTE: we do not want to de-dup this in the provider-utils, vite wants direct import with string literals.
export async function loadGeminiSDK(): Promise<GoogleGenerativeAIConstructor> {
  _loadPromise ??= import("@google/generative-ai")
    .then((mod) => mod.GoogleGenerativeAI)
    .catch(() => {
      _loadPromise = undefined;
      throw new Error(
        "@google/generative-ai is required for Gemini tasks. Install it with: bun add @google/generative-ai"
      );
    });
  return _loadPromise;
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

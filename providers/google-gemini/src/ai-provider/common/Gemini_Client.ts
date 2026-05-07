/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadProviderSdk, resolveApiKey } from "@workglow/ai-provider/common";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

let _sdk: typeof import("@google/generative-ai") | undefined;

export async function loadGeminiSDK() {
  if (!_sdk) {
    _sdk = await loadProviderSdk<typeof import("@google/generative-ai")>(
      "@google/generative-ai",
      "Gemini"
    );
  }
  return _sdk.GoogleGenerativeAI;
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

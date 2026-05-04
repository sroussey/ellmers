/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiModelConfig } from "./Gemini_ModelSchema";

let _sdk: typeof import("@google/generative-ai") | undefined;

export async function loadGeminiSDK() {
  if (!_sdk) {
    try {
      _sdk = await import("@google/generative-ai");
    } catch {
      throw new Error(
        "@google/generative-ai is required for Gemini tasks. Install it with: bun add @google/generative-ai"
      );
    }
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
  const apiKey =
    config?.credential_key ||
    config?.api_key ||
    (typeof process !== "undefined"
      ? process.env?.GOOGLE_API_KEY || process.env?.GEMINI_API_KEY
      : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Google API key: set provider_config.credential_key or the GOOGLE_API_KEY / GEMINI_API_KEY environment variable."
    );
  }
  return apiKey;
}

export function getModelName(model: GeminiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

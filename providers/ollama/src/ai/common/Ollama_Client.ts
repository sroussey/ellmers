/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadProviderSdk } from "@workglow/ai/provider-utils";
import { OLLAMA_DEFAULT_BASE_URL } from "./Ollama_Constants";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _OllamaClass: (new (config: { host: string }) => any) | undefined;

export async function loadOllamaSDK(): Promise<(new (config: { host: string }) => any) & {}> {
  if (!_OllamaClass) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = await loadProviderSdk<{ Ollama: new (config: { host: string }) => any }>(
      "ollama",
      "Ollama"
    );
    _OllamaClass = sdk.Ollama;
  }
  return _OllamaClass;
}

export async function getClient(model: OllamaModelConfig | undefined) {
  const Ollama = await loadOllamaSDK();
  const host = model?.provider_config?.base_url || OLLAMA_DEFAULT_BASE_URL;
  return new Ollama({ host });
}

export const getModelName = getOllamaModelName;

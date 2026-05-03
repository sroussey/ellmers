/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { OLLAMA_DEFAULT_BASE_URL } from "./Ollama_Constants";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _OllamaClass: (new (config: { host: string }) => any) | undefined;

export async function loadOllamaSDK(): Promise<(new (config: { host: string }) => any) & {}> {
  if (!_OllamaClass) {
    try {
      const sdk = await import("ollama");
      _OllamaClass = sdk.Ollama;
    } catch {
      throw new Error("ollama is required for Ollama tasks. Install it with: bun add ollama");
    }
  }
  return _OllamaClass;
}

export async function getClient(model: OllamaModelConfig | undefined) {
  const Ollama = await loadOllamaSDK();
  const host = model?.provider_config?.base_url || OLLAMA_DEFAULT_BASE_URL;
  return new Ollama({ host });
}

export const getModelName = getOllamaModelName;

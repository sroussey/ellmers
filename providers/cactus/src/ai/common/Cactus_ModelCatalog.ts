/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability } from "@workglow/ai/worker";
import {
  CACTUS_DEFAULT_HF_REPO,
  CACTUS_DEFAULT_REVISION,
  CACTUS_NEEDLE_26M,
} from "./Cactus_Constants";

export interface CactusCatalogEntry {
  readonly model_id: string;
  readonly title: string;
  readonly description: string;
  readonly hf_repo: string;
  readonly revision: string;
  readonly assets: {
    readonly weights: string;
    readonly vocab: string;
    readonly config: string;
  };
  readonly capabilities: readonly Capability[];
}

export const CACTUS_CATALOG: readonly CactusCatalogEntry[] = [
  {
    model_id: CACTUS_NEEDLE_26M,
    title: "Needle 26M",
    description:
      "Specialized 26M-parameter tool-routing transformer. INT4 SafeTensors, 22 MB. Runs via WASM in browser and Node/Bun.",
    hf_repo: CACTUS_DEFAULT_HF_REPO,
    revision: CACTUS_DEFAULT_REVISION,
    assets: {
      weights: "needle.safetensors",
      vocab: "vocab.txt",
      config: "config.json",
    },
    capabilities: ["tool-use"],
  },
] as const;

export function getCactusCatalogEntry(model_id: string): CactusCatalogEntry | undefined {
  return CACTUS_CATALOG.find((e) => e.model_id === model_id);
}

export function cactusAssetUrl(entry: CactusCatalogEntry, filename: string): string {
  return `https://huggingface.co/${entry.hf_repo}/resolve/${entry.revision}/${filename}`;
}

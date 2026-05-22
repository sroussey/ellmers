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

/**
 * A single asset file in a Cactus model catalog entry.
 *
 * `sha256` is the lowercase-hex digest of the canonical asset bytes at the
 * pinned `revision` in `CactusCatalogEntry`. It anchors the trust boundary:
 * any byte that fails this check is treated as adversarial and refused.
 */
export interface CactusAssetSpec {
  readonly filename: string;
  /** Lowercase hex SHA-256, exactly 64 characters. */
  readonly sha256: string;
  /** Expected byte length — used as a cheap pre-check before hashing. */
  readonly size: number;
}

export interface CactusCatalogEntry {
  readonly model_id: string;
  readonly title: string;
  readonly description: string;
  readonly hf_repo: string;
  readonly revision: string;
  readonly assets: {
    readonly weights: CactusAssetSpec;
    readonly vocab: CactusAssetSpec;
    readonly config: CactusAssetSpec;
  };
  readonly capabilities: readonly Capability[];
}

/**
 * Asserts that `s` is a lowercase hex SHA-256 (64 hex chars).
 *
 * Used at catalog load time to surface malformed entries before any
 * verification call sees them.
 */
export function assertHexSha256(s: string, ctxLabel?: string): asserts s is string {
  if (typeof s !== "string" || s.length !== 64 || !/^[0-9a-f]{64}$/.test(s)) {
    throw new Error(
      `Invalid SHA-256 in catalog${ctxLabel ? ` (${ctxLabel})` : ""}: ` +
        `expected 64 lowercase hex chars, got ${JSON.stringify(s)}`
    );
  }
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
      // MAINTAINER: replace with sha256 of the asset at the pinned revision;
      // see providers/cactus/scripts/hash-catalog.ts (planned follow-up).
      // Verification is skipped while the value is the literal placeholder, but
      // a clear warning is logged so this can never silently ship to release.
      weights: {
        filename: "needle.safetensors",
        sha256: "TODO_FILL_AT_RELEASE",
        size: 0,
      },
      vocab: {
        filename: "vocab.txt",
        sha256: "TODO_FILL_AT_RELEASE",
        size: 0,
      },
      config: {
        filename: "config.json",
        sha256: "TODO_FILL_AT_RELEASE",
        size: 0,
      },
    },
    capabilities: ["tool-use"],
  },
] as const;

export function getCactusCatalogEntry(model_id: string): CactusCatalogEntry | undefined {
  return CACTUS_CATALOG.find((e) => e.model_id === model_id);
}

/** Returns all three asset specs in fixed order: weights, vocab, config. */
export function assetSpecsOf(entry: CactusCatalogEntry): readonly CactusAssetSpec[] {
  return [entry.assets.weights, entry.assets.vocab, entry.assets.config];
}

export function cactusAssetUrl(
  entry: CactusCatalogEntry,
  filenameOrSpec: string | CactusAssetSpec
): string {
  const filename =
    typeof filenameOrSpec === "string" ? filenameOrSpec : filenameOrSpec.filename;
  return `https://huggingface.co/${entry.hf_repo}/resolve/${entry.revision}/${filename}`;
}

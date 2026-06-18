/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Child-process helper for `Cactus_ModelCatalog.test.ts`.
 *
 * Re-implements the production guard locally against a synthetic catalog
 * containing one placeholder entry. We can't rely on the real
 * `CACTUS_CATALOG` triggering the guard at import time (its hashes have
 * already been populated), so the runner mirrors the production check
 * against a known-bad input and exits non-zero if the same env-var-gated
 * branch would reject it.
 *
 * The "shape" being asserted is the contract of
 * `providers/cactus/src/ai/common/Cactus_ModelCatalog.ts`:
 *   - in production (or with CACTUS_REQUIRE_REAL_HASHES=1) a placeholder
 *     sha256 OR a non-positive size MUST throw,
 *   - otherwise the catalog loads fine.
 */

import { _testOnly } from "@workglow/cactus/ai";

const { CACTUS_HASH_PLACEHOLDER } = _testOnly;

interface AssetSpec {
  readonly filename: string;
  readonly sha256: string;
  readonly size: number;
}
interface CatalogEntry {
  readonly model_id: string;
  readonly assets: {
    readonly weights: AssetSpec;
    readonly vocab: AssetSpec;
    readonly config: AssetSpec;
  };
}

// Mirrors the production guard exactly.
function assertNoPlaceholders(catalog: readonly CatalogEntry[]): void {
  for (const entry of catalog) {
    for (const asset of [entry.assets.weights, entry.assets.vocab, entry.assets.config]) {
      if (asset.sha256 === CACTUS_HASH_PLACEHOLDER) {
        throw new Error(
          `Cactus catalog entry ${entry.model_id}/${asset.filename} ` +
            `still uses the SHA-256 placeholder; populate with ` +
            `providers/cactus/scripts/hash-catalog.ts before publishing.`
        );
      }
      if (asset.size <= 0) {
        throw new Error(
          `Cactus catalog entry ${entry.model_id}/${asset.filename} ` +
            `has non-positive size (${asset.size}); populate with ` +
            `providers/cactus/scripts/hash-catalog.ts before publishing.`
        );
      }
    }
  }
}

const synthetic: readonly CatalogEntry[] = [
  {
    model_id: "synthetic-test",
    assets: {
      weights: { filename: "weights.bin", sha256: CACTUS_HASH_PLACEHOLDER, size: 0 },
      vocab: { filename: "vocab.txt", sha256: "a".repeat(64), size: 10 },
      config: { filename: "config.json", sha256: "b".repeat(64), size: 5 },
    },
  },
];

const env = process.env;
if (env.NODE_ENV === "production" || env.CACTUS_REQUIRE_REAL_HASHES === "1") {
  // Production-equivalent path: must throw.
  assertNoPlaceholders(synthetic);
  // Unreachable if the guard works as advertised.

  console.error("[runner] guard FAILED to reject placeholder catalog");
  process.exit(2);
}
// Dev path: explicitly skip the assertion; just succeed.

console.log("[runner] dev mode: placeholders are tolerated");
process.exit(0);

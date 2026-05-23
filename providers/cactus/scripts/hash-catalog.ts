/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hash every asset referenced by `CACTUS_CATALOG`, print a JSON report, and
 * optionally rewrite the catalog source file with the real values.
 *
 * Usage:
 *   bun providers/cactus/scripts/hash-catalog.ts            # dry run (report only)
 *   bun providers/cactus/scripts/hash-catalog.ts --write    # rewrite catalog in place
 *
 * The script fetches each asset URL with the global `fetch`, computes
 * `sha256Hex` over the body, and captures `byteLength`. Network failures
 * cause a non-zero exit code and the catalog file is left untouched.
 *
 * In `--write` mode the catalog file is rewritten by string-replacing the
 * placeholder `CACTUS_HASH_PLACEHOLDER` and the `size: 0` literal on the
 * same asset block. The rewrite is conservative: if an asset already has a
 * non-placeholder hash AND a positive size, it is skipped.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assetSpecsOf, CACTUS_CATALOG, cactusAssetUrl } from "../src/ai/common/Cactus_ModelCatalog";
import { CACTUS_HASH_PLACEHOLDER, sha256Hex } from "../src/ai/common/Cactus_Integrity";

interface AssetReport {
  readonly model_id: string;
  readonly filename: string;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

async function hashAsset(url: string): Promise<{ sha256: string; size: number }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  const ab = await resp.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const sha256 = await sha256Hex(bytes);
  return { sha256, size: bytes.byteLength };
}

async function collectReports(): Promise<AssetReport[]> {
  const reports: AssetReport[] = [];
  for (const entry of CACTUS_CATALOG) {
    for (const spec of assetSpecsOf(entry)) {
      const url = cactusAssetUrl(entry, spec.filename);
      // eslint-disable-next-line no-console
      console.error(`fetching ${entry.model_id}/${spec.filename} from ${url}`);
      const { sha256, size } = await hashAsset(url);
      reports.push({ model_id: entry.model_id, filename: spec.filename, url, sha256, size });
    }
  }
  return reports;
}

/**
 * Rewrite the catalog source file in place. We match each asset's
 * placeholder block by filename + the `CACTUS_HASH_PLACEHOLDER` token,
 * then replace both the `sha256` and `size` lines.
 *
 * The matcher is conservative — it requires both the filename and the
 * placeholder to be present in the same asset block, so a partially-populated
 * catalog won't be over-written.
 */
function rewriteCatalogFile(catalogPath: string, reports: readonly AssetReport[]): number {
  const source = readFileSync(catalogPath, "utf8");
  let next = source;
  let replaced = 0;
  for (const r of reports) {
    // Match block:
    //   filename: "<r.filename>",
    //   sha256: CACTUS_HASH_PLACEHOLDER,
    //   size: 0,
    // (whitespace-tolerant; size may be any number, sha256 may be the constant or quoted hex placeholder)
    const blockRe = new RegExp(
      `(filename:\\s*"${escapeRegex(r.filename)}",\\s*\\n\\s*)` +
        `sha256:\\s*(?:CACTUS_HASH_PLACEHOLDER|"${escapeRegex(CACTUS_HASH_PLACEHOLDER)}"),` +
        `(\\s*\\n\\s*)size:\\s*\\d+,`,
      "m"
    );
    const updated = next.replace(
      blockRe,
      `$1sha256: "${r.sha256}",$2size: ${r.size},`
    );
    if (updated !== next) {
      replaced += 1;
      next = updated;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[hash-catalog] no placeholder block matched for ${r.model_id}/${r.filename}; skipping`
      );
    }
  }
  if (replaced > 0) {
    writeFileSync(catalogPath, next, "utf8");
  }
  return replaced;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const reports = await collectReports();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ assets: reports }, null, 2));

  if (write) {
    const here = dirname(fileURLToPath(import.meta.url));
    const catalogPath = resolve(here, "../src/ai/common/Cactus_ModelCatalog.ts");
    const replaced = rewriteCatalogFile(catalogPath, reports);
    // eslint-disable-next-line no-console
    console.error(`[hash-catalog] rewrote ${replaced} of ${reports.length} asset blocks`);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[hash-catalog] failed:", err);
  process.exit(1);
});

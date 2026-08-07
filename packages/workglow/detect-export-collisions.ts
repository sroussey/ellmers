/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build-time detector for ambiguous re-exports in the meta-package barrels.
 *
 * Each barrel (`common.ts`, `browser.ts`, `node.ts`) fans a set of
 * sub-packages out through `export * from "<pkg>"`. When two of those sources
 * export the same symbol name, ESM silently makes that name ambiguous — a plain
 * `import { X } from "workglow"` resolves to nothing with no error. This detector
 * fails the build when it finds such a name.
 *
 * A name is only a real collision when the two sources resolve it to different
 * bindings, which is exactly ESM's own ambiguity rule. So the detector imports
 * each contributing source and compares the actual exported values by reference:
 * a symbol re-exported through two paths to the same binding (e.g.
 * `@workglow/util` directly and `@workglow/task-graph`, which re-exports it) is
 * the same value and is not ambiguous. Reference identity is preserved through
 * re-exports whether a source resolves to its `src` (under `use-source`) or its
 * bundled `dist` (a normal build), so the check gives the same answer either way.
 * Names the barrel pins with an explicit `export { X } from "<pkg>"` are resolved
 * to that one source and are skipped. Type-only exports have no runtime value and
 * are naturally excluded.
 *
 * Collisions among sub-paths of a single package (e.g. `@workglow/util` and
 * `@workglow/util/media`, or `@workglow/postgres/storage` and its `/job-queue`)
 * are not reported: bundling each entry point with `--packages=external` inlines
 * the package's own internal modules into every entry bundle, so a shared
 * internal symbol has a distinct identity per bundle even though it is one
 * declaration. That is the package's concern, not a clash between independent
 * packages, which is what this detector guards.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";

const STAR_RE = /export\s+\*\s+from\s+["']([^"']+)["']/g;
const NAMED_FROM_RE = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/g;

function findStarSpecs(source: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  STAR_RE.lastIndex = 0;
  while ((m = STAR_RE.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

function findPinnedNames(source: string): Set<string> {
  const pinned = new Set<string>();
  let m: RegExpExecArray | null;
  NAMED_FROM_RE.lastIndex = 0;
  while ((m = NAMED_FROM_RE.exec(source)) !== null) {
    for (const raw of m[1].split(",")) {
      const entry = raw.trim();
      if (entry.length === 0) continue;
      const parts = entry.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim();
      if (exported.length === 0 || exported === "type") continue;
      pinned.add(exported);
    }
  }
  return pinned;
}

function packageOf(spec: string): string {
  if (spec.startsWith(".")) return "\0local";
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

async function importSource(spec: string, fromDir: string, barrelPath: string): Promise<unknown> {
  let resolved: string;
  try {
    resolved = Bun.resolveSync(spec, fromDir);
  } catch {
    throw new Error(`Cannot resolve "export * from \\"${spec}\\"" in ${barrelPath}`);
  }
  return import(resolved);
}

export interface CollisionReport {
  readonly barrel: string;
  readonly symbol: string;
  readonly sources: readonly string[];
}

/**
 * Scan a barrel file's direct `export *` sources and return every symbol name a
 * `import { X } from "workglow"` would resolve ambiguously (exported by more than
 * one source with differing runtime bindings). Names the barrel re-exports
 * explicitly with `export { X } from ...` are pinned to that source and skipped.
 */
export async function detectBarrelCollisions(barrelPath: string): Promise<CollisionReport[]> {
  const source = readFileSync(barrelPath, "utf8");
  const dir = dirname(barrelPath);
  const starSpecs = findStarSpecs(source);
  if (starSpecs.length < 2) return [];

  const pinned = findPinnedNames(source);
  const contributions = new Map<string, { readonly spec: string; readonly value: unknown }[]>();

  for (const spec of starSpecs) {
    const mod = (await importSource(spec, dir, barrelPath)) as Record<string, unknown>;
    for (const name of Object.keys(mod)) {
      if (name === "default" || pinned.has(name)) continue;
      const list = contributions.get(name) ?? [];
      list.push({ spec, value: mod[name] });
      contributions.set(name, list);
    }
  }

  const reports: CollisionReport[] = [];
  for (const [symbol, list] of contributions) {
    if (list.length < 2) continue;
    const distinctValues = new Set(list.map((c) => c.value));
    if (distinctValues.size <= 1) continue;
    const packages = new Set(list.map((c) => packageOf(c.spec)));
    if (packages.size <= 1) continue;
    const sources = [...new Set(list.map((c) => c.spec))].sort();
    reports.push({ barrel: barrelPath, symbol, sources });
  }
  reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return reports;
}

/**
 * Run the collision detector across every barrel and throw when any barrel has
 * an ambiguous re-export, printing each colliding symbol and its sources.
 */
export async function assertNoExportCollisions(barrelPaths: readonly string[]): Promise<void> {
  const all: CollisionReport[] = [];
  for (const barrelPath of barrelPaths) all.push(...(await detectBarrelCollisions(barrelPath)));
  if (all.length === 0) return;

  const lines: string[] = ["Ambiguous re-exports detected in the workglow meta-package barrels:"];
  const byBarrel = new Map<string, CollisionReport[]>();
  for (const report of all) {
    const list = byBarrel.get(report.barrel) ?? [];
    list.push(report);
    byBarrel.set(report.barrel, list);
  }
  for (const [barrel, reports] of byBarrel) {
    lines.push(`  ${barrel}:`);
    for (const { symbol, sources } of reports) {
      lines.push(`    "${symbol}" exported by: ${sources.join(", ")}`);
    }
  }
  lines.push(
    "Resolve each name to a single source (e.g. an explicit `export { X } from ...`) or rename the conflicting export."
  );
  throw new Error(lines.join("\n"));
}

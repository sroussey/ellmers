/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build-time detector for ambiguous re-exports in the meta-package barrels.
 *
 * Each barrel (`common.ts`, `browser.ts`, `node.ts`, `bun.ts`) fans a set of
 * sub-packages out through `export * from "<pkg>"`. When two of those sources
 * export the same symbol name, ESM silently makes that name ambiguous — a plain
 * `import { X } from "workglow"` resolves to nothing with no error. This detector
 * fails the build when it finds such a name.
 *
 * A name is only a real collision when the two sources resolve it to different
 * origin bindings. A symbol re-exported through two paths (e.g. `@workglow/util`
 * directly and `@workglow/task-graph`, which itself re-exports it) is the same
 * binding and is not ambiguous, so it must not be flagged. Names the barrel pins
 * with an explicit `export { X } from "<pkg>"` are resolved to that one source
 * and are likewise skipped.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";

const transpiler = new Bun.Transpiler({ loader: "ts" });

const STAR_RE = /export\s+\*\s+from\s+["']([^"']+)["']/g;
const NAMED_FROM_RE = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

interface NamedReExport {
  readonly spec: string;
  readonly names: readonly { readonly orig: string; readonly exported: string }[];
}

function parseNamedList(body: string): { readonly orig: string; readonly exported: string }[] {
  const out: { orig: string; exported: string }[] = [];
  for (const raw of body.split(",")) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    const parts = entry.split(/\s+as\s+/);
    const orig = parts[0].trim();
    const exported = (parts[1] ?? parts[0]).trim();
    if (orig.length === 0 || orig === "type") continue;
    out.push({ orig, exported });
  }
  return out;
}

function findStarSpecs(source: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  STAR_RE.lastIndex = 0;
  while ((m = STAR_RE.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

function findNamedReExports(source: string): NamedReExport[] {
  const out: NamedReExport[] = [];
  let m: RegExpExecArray | null;
  NAMED_FROM_RE.lastIndex = 0;
  while ((m = NAMED_FROM_RE.exec(source)) !== null) {
    out.push({ spec: m[2], names: parseNamedList(m[1]) });
  }
  return out;
}

function resolve(spec: string, fromDir: string): string | undefined {
  try {
    return Bun.resolveSync(spec, fromDir);
  } catch {
    return undefined;
  }
}

/**
 * Map every runtime export name of a module to a stable origin key
 * (`<defining-file>#<local-name>`), following named and star re-exports to the
 * binding's declaration so identical bindings share an origin.
 */
function resolveModuleExports(
  path: string,
  cache: Map<string, Map<string, string>>,
  visiting: Set<string>
): Map<string, string> {
  const cached = cache.get(path);
  if (cached) return cached;
  if (visiting.has(path)) return new Map();
  visiting.add(path);

  const map = new Map<string, string>();
  const source = readFileSync(path, "utf8");
  const dir = dirname(path);
  const own = new Set(transpiler.scan(source).exports.filter((n) => n !== "default"));
  const pinnedByNamed = new Set<string>();

  for (const { spec, names } of findNamedReExports(source)) {
    const childPath = resolve(spec, dir);
    const child = childPath
      ? resolveModuleExports(childPath, cache, visiting)
      : new Map<string, string>();
    for (const { orig, exported } of names) {
      if (!own.has(exported)) continue;
      map.set(exported, child.get(orig) ?? `${childPath ?? spec}#${orig}`);
      pinnedByNamed.add(exported);
    }
  }

  for (const name of own) {
    if (!pinnedByNamed.has(name)) map.set(name, `${path}#${name}`);
  }

  for (const spec of findStarSpecs(source)) {
    const childPath = resolve(spec, dir);
    if (!childPath) continue;
    const child = resolveModuleExports(childPath, cache, visiting);
    for (const [name, origin] of child) {
      if (!map.has(name)) map.set(name, origin);
    }
  }

  visiting.delete(path);
  cache.set(path, map);
  return map;
}

export interface CollisionReport {
  readonly barrel: string;
  readonly symbol: string;
  readonly sources: readonly string[];
}

/**
 * Scan a barrel file's direct `export *` sources and return every symbol name a
 * `import { X } from "workglow"` would resolve ambiguously (exported by more than
 * one source with differing origin bindings). Names the barrel re-exports
 * explicitly with `export { X } from ...` are pinned to that source and skipped.
 */
export function detectBarrelCollisions(barrelPath: string): CollisionReport[] {
  const source = readFileSync(barrelPath, "utf8");
  const dir = dirname(barrelPath);
  const cache = new Map<string, Map<string, string>>();

  const pinned = new Set<string>();
  for (const { names } of findNamedReExports(source)) {
    for (const { exported } of names) pinned.add(exported);
  }

  // symbol -> (origin key -> sources declaring that origin)
  const byName = new Map<string, Map<string, Set<string>>>();
  for (const spec of findStarSpecs(source)) {
    const childPath = resolve(spec, dir);
    if (!childPath) {
      throw new Error(`Cannot resolve "export * from \\"${spec}\\"" in ${barrelPath}`);
    }
    const exportsMap = resolveModuleExports(childPath, cache, new Set());
    for (const [name, origin] of exportsMap) {
      if (pinned.has(name)) continue;
      let origins = byName.get(name);
      if (!origins) {
        origins = new Map();
        byName.set(name, origins);
      }
      let sources = origins.get(origin);
      if (!sources) {
        sources = new Set();
        origins.set(origin, sources);
      }
      sources.add(spec);
    }
  }

  const reports: CollisionReport[] = [];
  for (const [symbol, origins] of byName) {
    if (origins.size <= 1) continue;
    const sources = new Set<string>();
    for (const specs of origins.values()) for (const s of specs) sources.add(s);
    reports.push({ barrel: barrelPath, symbol, sources: [...sources].sort() });
  }
  reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return reports;
}

/**
 * Run the collision detector across every barrel and throw when any barrel has
 * an ambiguous re-export, printing each colliding symbol and its sources.
 */
export function assertNoExportCollisions(barrelPaths: readonly string[]): void {
  const all: CollisionReport[] = [];
  for (const barrelPath of barrelPaths) all.push(...detectBarrelCollisions(barrelPath));
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

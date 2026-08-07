/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const workspaceRoots = ["packages", "providers"] as const;

/**
 * The complete set of `exports` entries that still carry a `"bun"` condition,
 * as `"<package name> <subpath>"`. Every one is a genuine runtime divergence:
 *
 * - `@workglow/util .`        — `Worker.bun` vs `Worker.node`
 * - `@workglow/util ./worker` — `dist/worker-bun.js` vs `dist/worker-node.js`
 * - `@workglow/sqlite ./storage` — `bun:sqlite` vs the better-sqlite3 driver
 *
 * Everywhere else Bun resolves the default `"import"` and loads the node build,
 * which is byte-identical to what a duplicated `src/bun.ts` would have produced.
 *
 * This fixture is deliberately exact, so it fails in both directions: on a
 * redundant `"bun"` condition added back, and on one of the three being deleted
 * (deleting `@workglow/util`'s `"./worker"` would silently swap every Bun
 * consumer onto `Worker.node` and `node:worker_threads`).
 *
 * Changing it means changing prose too — the same list is stated in
 * `.claude/CLAUDE.md` ("No `bun` entry unless it differs") and twice in
 * `docs/technical/19-build-system.md` (the "Standard Two-Target Pattern" rule
 * and the "Extended Pattern (util)" build table). `docs/technical/18-multi-runtime-abstraction.md`
 * also describes `@workglow/util`'s `./worker` condition as the exception.
 */
const EXPECTED_BUN_CONDITIONS = [
  "@workglow/sqlite ./storage",
  "@workglow/util .",
  "@workglow/util ./worker",
] as const;

interface ExportsNode {
  readonly [condition: string]: string | ExportsNode | undefined;
}

const isExportsNode = (value: unknown): value is ExportsNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasBunCondition = (node: unknown): boolean => {
  if (!isExportsNode(node)) return false;
  if (Object.prototype.hasOwnProperty.call(node, "bun")) return true;
  return Object.values(node).some((child) => hasBunCondition(child));
};

const collectBunConditions = (): string[] => {
  const found: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const rootDir = join(repoRoot, workspaceRoot);
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(rootDir, entry.name, "package.json");
      let manifest: { name?: string; exports?: unknown };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        continue; // no package.json in this directory
      }
      const { name, exports } = manifest;
      if (typeof name !== "string" || !isExportsNode(exports)) continue;
      for (const [subpath, target] of Object.entries(exports)) {
        if (hasBunCondition(target)) found.push(`${name} ${subpath}`);
      }
    }
  }
  return found.sort();
};

describe("bun export conditions", () => {
  it("exist only where the Bun implementation genuinely differs", () => {
    expect(collectBunConditions()).toEqual([...EXPECTED_BUN_CONDITIONS]);
  });

  it("scans every workspace, so an empty result cannot pass vacuously", () => {
    const manifestCount = workspaceRoots.reduce((total, workspaceRoot) => {
      const rootDir = join(repoRoot, workspaceRoot);
      return (
        total +
        readdirSync(rootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
      );
    }, 0);
    expect(manifestCount).toBeGreaterThan(20);
  });

  it("keeps each surviving condition pointed at a bun-specific target", () => {
    const utilExports = JSON.parse(
      readFileSync(join(repoRoot, "packages/util/package.json"), "utf8")
    ).exports;
    const sqliteExports = JSON.parse(
      readFileSync(join(repoRoot, "providers/sqlite/package.json"), "utf8")
    ).exports;

    expect(utilExports["."].bun.import).toBe("./dist/bun.js");
    expect(utilExports["."].import).toBe("./dist/node.js");
    expect(utilExports["./worker"].bun.import).toBe("./dist/worker-bun.js");
    expect(utilExports["./worker"].import).toBe("./dist/worker-node.js");
    expect(sqliteExports["./storage"].bun.import).toBe("./dist/storage/bun.js");
    expect(sqliteExports["./storage"].import).toBe("./dist/storage/node.js");
  });
});

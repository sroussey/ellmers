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

interface ExportsNode {
  readonly [condition: string]: string | ExportsNode | undefined;
}

interface Manifest {
  readonly name?: string | undefined;
  readonly license?: string | undefined;
  readonly private?: boolean | undefined;
  readonly exports?: unknown;
  readonly sideEffects?: unknown;
}

interface Workspace {
  readonly name: string;
  readonly manifest: Manifest;
}

const isExportsNode = (value: unknown): value is ExportsNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every runtime (non-`types`) target reachable in an `exports` map. */
const collectRuntimeTargets = (node: unknown, out: Set<string>): Set<string> => {
  if (!isExportsNode(node)) return out;
  for (const [condition, child] of Object.entries(node)) {
    if (condition === "types") continue;
    if (typeof child === "string") {
      out.add(child);
    } else {
      collectRuntimeTargets(child, out);
    }
  }
  return out;
};

const readWorkspaces = (): Workspace[] => {
  const workspaces: Workspace[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const rootDir = join(repoRoot, workspaceRoot);
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let manifest: Manifest;
      try {
        manifest = JSON.parse(readFileSync(join(rootDir, entry.name, "package.json"), "utf8"));
      } catch {
        continue; // no package.json in this directory
      }
      if (typeof manifest.name !== "string") continue;
      workspaces.push({ name: manifest.name, manifest });
    }
  }
  return workspaces.sort((a, b) => a.name.localeCompare(b.name));
};

const workspaces = readWorkspaces();

/**
 * An array-form `sideEffects` is an allow-list: a bundler treats every file NOT
 * named in it as side-effect-free and free to drop, along with the imports that
 * reach it. That is safe only when the unlisted entry points are pure
 * re-exports; an entry whose module body installs something — a prototype
 * patch, a registry entry — must be listed, or the bundler is entitled to elide
 * the import chain that would have run it.
 *
 * The fixture below is deliberately EXACT and fails in both directions, because
 * both directions are silent bugs:
 *
 * - an entry point that gained a side effect but was not listed is dropped from
 *   production bundles while dev and Node keep working; and
 * - a listed entry point that no longer has one (or, worse, whose dist file was
 *   renamed) leaves a stale path in the allow-list. The stale entry protects
 *   nothing — it names a file the bundler never sees — so the real entry point
 *   silently reverts to "safe to drop". That is why the second test requires
 *   every listed path to be a real runtime target of the same `exports` map.
 *
 * `workglow` carries the only interesting entry: `./dist/auto-bootstrap.js`, the
 * one module in the meta-package whose body runs anything (it bootstraps the
 * global registry and calls `installWorkflowTriggers()`). Its barrel must stay
 * ELIDABLE — it re-exports `@workglow/duckdb`, `postgres`, `sqlite` and `mcp`
 * among others, none of which declare `sideEffects` at all, so a bundler that
 * cannot drop the barrel must keep every one of them. That is what
 * `@workglow/triggers` giving up its import-time `Workflow.prototype` patch
 * bought.
 */
const EXPECTED_SIDE_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  workglow: ["./dist/auto-bootstrap.js"],
  "@workglow/javascript": ["./dist/task.js"],
};

describe("package sideEffects declarations", () => {
  it("are declared by exactly the packages that need them, with exactly these entries", () => {
    const declared = Object.fromEntries(
      workspaces
        .filter(({ manifest }) => Array.isArray(manifest.sideEffects))
        .map(({ name, manifest }) => [name, manifest.sideEffects as readonly string[]])
    );
    expect(declared).toEqual(EXPECTED_SIDE_EFFECTS);
  });

  it("list only real runtime export targets, so a renamed dist file cannot leave a stale entry", () => {
    const stale = workspaces.flatMap(({ name, manifest }) => {
      const { sideEffects } = manifest;
      if (!Array.isArray(sideEffects)) return [];
      const targets = collectRuntimeTargets(manifest.exports, new Set<string>());
      return sideEffects
        .filter((entry: unknown) => typeof entry !== "string" || !targets.has(entry))
        .map((entry: unknown) => `${name} ${String(entry)}`);
    });
    expect(stale).toEqual([]);
  });

  it("are the only allow-lists: every other package claims purity or stays silent", () => {
    const unexpected = workspaces
      .filter(({ name }) => !(name in EXPECTED_SIDE_EFFECTS))
      .filter(
        ({ manifest }) => manifest.sideEffects !== undefined && manifest.sideEffects !== false
      )
      .map(({ name, manifest }) => `${name}: ${JSON.stringify(manifest.sideEffects)}`);
    expect(unexpected).toEqual([]);
  });

  it("scans every workspace, so an empty result cannot pass vacuously", () => {
    expect(workspaces.length).toBeGreaterThan(20);
  });
});

describe("package licenses", () => {
  it("are declared Apache-2.0 on every publishable manifest", () => {
    const wrong = workspaces
      .filter(({ manifest }) => manifest.private !== true)
      .filter(({ manifest }) => manifest.license !== "Apache-2.0")
      .map(({ name, manifest }) => `${name}: ${JSON.stringify(manifest.license)}`);
    expect(wrong).toEqual([]);
  });
});

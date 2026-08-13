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
 * `workglow` got this wrong: it listed only `./dist/auto-bootstrap.js` while its
 * `.` entry re-exports `@workglow/triggers`, whose module body patches
 * `Workflow.prototype.trigger`. `@workglow/triggers` deliberately omits
 * `sideEffects: false` to protect that patch, but webpack re-routes
 * `import { Workflow } from "workglow"` straight to `@workglow/task-graph` and
 * never consults the intermediary's own dependencies — so the patch was dropped
 * in production bundles while dev and Node kept working.
 *
 * Omitting the field entirely (the conservative default every other package here
 * relies on) is what this asserts back to: an entry point a consumer imports
 * from must either be listed, or the package must not make the claim at all.
 */
describe("package sideEffects declarations", () => {
  it("cover every exported entry point of the packages that declare them", () => {
    const uncovered = workspaces.flatMap(({ name, manifest }) => {
      const { sideEffects } = manifest;
      if (!Array.isArray(sideEffects)) return [];
      const targets = collectRuntimeTargets(manifest.exports, new Set<string>());
      return [...targets]
        .filter((target) => !sideEffects.includes(target))
        .map((target) => `${name} ${target}`);
    });
    expect(uncovered).toEqual([]);
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

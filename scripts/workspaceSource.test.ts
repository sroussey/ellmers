/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stubSpecsFor, type PackageManifest } from "./lib/sourceStubs";
import { ROOT } from "./lib/testDiscovery";
import { distToSource, listWorkspacePackages } from "./lib/workspaceSource";

const packages = listWorkspacePackages(ROOT);

/**
 * The redirect has to be TOTAL to be worth having. An entry point whose dist
 * file has no source counterpart quietly keeps resolving to the bundle, and
 * the only symptom is that one package's coverage collapses back onto
 * `dist/*` — the exact artifact this exists to remove, now affecting a single
 * package rather than all of them, which is far harder to notice.
 *
 * `stubSpecsFor` is the same enumeration `use-source` stubs from, so the two
 * mechanisms cannot drift into disagreeing about what a package's entries are.
 */
describe("workspace source resolution", () => {
  it("finds every workspace package", () => {
    const names = packages.map((p) => p.name);
    expect(names).toContain("@workglow/ai");
    expect(names).toContain("@workglow/util");
    expect(names).toContain("@workglow/anthropic");
    // Private workspaces count too: their subpath imports resolve in tests.
    expect(names).toContain("@workglow/aws");
  });

  it("maps every published runtime entry back to its source file", () => {
    const unmapped: string[] = [];
    for (const pkg of packages) {
      const manifest = JSON.parse(
        readFileSync(join(pkg.dir, "package.json"), "utf8")
      ) as PackageManifest;
      for (const spec of stubSpecsFor(manifest)) {
        if (spec.kind === "types") continue; // never resolved at runtime
        const target = join(pkg.dir, spec.target);
        if (distToSource(target) === undefined) unmapped.push(`${pkg.name} ${spec.target}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it("maps a dist entry to its source twin", () => {
    const aiNode = join(ROOT, "packages/ai/dist/node.js");
    expect(distToSource(aiNode)).toBe(join(ROOT, "packages/ai/src/node.ts"));
  });

  it("leaves build output with no source twin alone", () => {
    // A generated or copied artifact must keep resolving to the built file
    // rather than to a source path that does not exist.
    const invented = join(ROOT, "packages/ai/dist/not-a-real-entry.js");
    expect(existsSync(invented)).toBe(false);
    expect(distToSource(invented)).toBeUndefined();
    expect(distToSource(join(ROOT, "packages/ai/src/node.ts"))).toBeUndefined();
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every workspace in this repo is released as one family: `bunset --patch
 * --all` bumps the root and all 42 workspaces together, and `workglow` pulls
 * its siblings in as `workspace:*`, which resolves to whatever version is on
 * disk at publish time.
 *
 * So a workspace left one version behind is not a cosmetic inconsistency, it
 * is a permanent one: the next `--patch --all` takes the family to N+1 and
 * publishes the straggler at N — still one behind, forever — and the
 * meta-package ships declaring a dependency on a stale version. Nothing in the
 * release path notices, because `--all` bumps each manifest from its own
 * current value rather than from a family value.
 *
 * PRIVATE workspaces are included deliberately. `bunset --all` bumps them too,
 * and exempting them here would recreate exactly the hole this closes, one tier
 * down.
 */

/** Workspace groups from the root `workspaces` globs. */
const WORKSPACE_GROUPS = ["packages", "providers", "examples"] as const;

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { workspaces?: unknown };
      if (Array.isArray(pkg.workspaces)) return dir;
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the workspace root from " + import.meta.url);
}

interface ManifestVersion {
  /** Repo-relative manifest path, so a failure names the file to edit. */
  readonly manifest: string;
  readonly version: string;
}

function manifestVersions(root: string): ManifestVersion[] {
  const found: ManifestVersion[] = [];
  const read = (relative: string): void => {
    const pkg = JSON.parse(readFileSync(join(root, relative), "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string") found.push({ manifest: relative, version: pkg.version });
  };
  read("package.json");
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = `${group}/${entry.name}/package.json`;
      if (existsSync(join(root, relative))) read(relative);
    }
  }
  return found;
}

describe("workspace versions", () => {
  const root = repoRoot();
  const versions = manifestVersions(root);

  it("finds every workspace manifest", () => {
    // Guards against the scan finding nothing and the check below passing on an
    // empty set.
    expect(versions.length).toBeGreaterThan(40);
    expect(versions.map((v) => v.manifest)).toContain("package.json");
    expect(versions.map((v) => v.manifest)).toContain("packages/bootstrap/package.json");
  });

  it("releases the root and every workspace at one version", () => {
    const distinct = [...new Set(versions.map((v) => v.version))].sort();
    // Named rather than counted, so a failure says which manifest to edit
    // instead of only that the set has two entries.
    const byVersion = distinct.map((version) => ({
      version,
      manifests: versions.filter((v) => v.version === version).map((v) => v.manifest),
    }));
    expect(byVersion.length, JSON.stringify(byVersion, null, 2)).toBe(1);
  });
});

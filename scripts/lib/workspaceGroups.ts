/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The top-level directories that hold workspace packages, derived from the root
 * manifest's `workspaces` field.
 *
 * The same three-element list — `packages`, `providers`, `examples` — was
 * written out by hand in four places (the source-resolving plugin, the test
 * discovery walk, the published-entry sweep, and the coverage denominator).
 * Adding a fourth group to `package.json` therefore silently no-oped in all of
 * them: nothing errors, the walks simply never look in the new directory, and
 * the only symptom is a shorter file list in a report nobody diffs.
 *
 * This module owns the derivation and nothing else, for the same reason
 * `testDiscovery.ts` gives for owning its own: several modules must agree on
 * it, so none of them should own it.
 *
 * Node-portable on purpose. `vitest.config.ts` imports this and Vite loads that
 * config under Node, so `Bun.Glob` (which `scripts/lib/util.ts` uses for its
 * own, Bun-only, workspace scan) is not available here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The workspace groups declared by the root manifest, in declaration order and
 * de-duplicated.
 *
 * A pattern is reduced to the single directory a scan can walk:
 * `"./packages/*"` → `"packages"`. Anything that does not reduce to exactly one
 * scannable directory THROWS rather than being guessed at — a recursive pattern
 * names no single directory to read, and picking its prefix would quietly walk
 * the wrong tree, which is the same silent no-op this module exists to remove.
 */
export function workspaceGroups(root: string): readonly string[] {
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { workspaces?: unknown };
  const patterns = manifest.workspaces;
  if (!Array.isArray(patterns)) {
    throw new Error(
      `${manifestPath} declares no "workspaces" array, so there are no workspace groups to derive.`
    );
  }

  const groups: string[] = [];
  for (const raw of patterns) {
    if (typeof raw !== "string") {
      throw new Error(`${manifestPath}: workspace pattern ${JSON.stringify(raw)} is not a string.`);
    }
    const pattern = raw.startsWith("./") ? raw.slice(2) : raw;
    const star = pattern.indexOf("*");
    const head = star === -1 ? pattern : pattern.slice(0, star);
    const tail = star === -1 ? "" : pattern.slice(star);
    // `packages/*` is the only glob shape that names one directory. `**/x`,
    // `*/x` and a bare `**` all match at more than one depth.
    if (tail !== "" && tail !== "*") {
      throw new Error(
        `${manifestPath}: workspace pattern "${raw}" matches more than one directory depth. ` +
          `Only a plain directory or "<dir>/*" reduces to a single scannable group.`
      );
    }
    const group = head.endsWith("/") ? head.slice(0, -1) : head;
    if (group === "") {
      throw new Error(
        `${manifestPath}: workspace pattern "${raw}" names no directory to scan. ` +
          `Expected something like "./packages/*".`
      );
    }
    if (!groups.includes(group)) groups.push(group);
  }
  return groups;
}

/**
 * The coverage `include` globs for a set of groups.
 *
 * The denominator is every workspace package's own `src`, so it has to be
 * derived from the same groups everything else walks: a group present in the
 * scan but absent here has its source rewritten to `src`, executed by its own
 * tests, and then left out of the report entirely — invisible, because a
 * coverage report shows a shorter file list rather than an error.
 */
export function coverageIncludeGlobs(groups: readonly string[]): string[] {
  return groups.map((group) => `${group}/*/src/**/*.{ts,tsx}`);
}

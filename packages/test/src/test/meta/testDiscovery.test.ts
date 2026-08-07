/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  discoverTestFiles,
  findAllTestFiles,
  findUnreachable,
  KNOWN_KINDS,
  listSections,
  matchesKind,
  ROOT,
  SECTION_GROUPS,
} from "../../../../../scripts/lib/testDiscovery";

/**
 * Guards the runner's file selection.
 *
 * A test file no section+kind selection reaches never runs in CI, because every
 * CI job passes a kind. That is not hypothetical: a hand-maintained section
 * table previously omitted seven directories, and pointed nowhere outside
 * `packages/test`, leaving 28 files that no CI job could select. Discovery makes
 * the omission structurally impossible; these assertions keep it that way.
 */
describe("test discovery", () => {
  const files = discoverTestFiles();

  it("finds test files", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("discovers every test file that exists anywhere in the repo", () => {
    // The load-bearing assertion. Checked against an independent walk of the
    // whole tree, because a discovered file's section is derived from its own
    // directory — so "every file is in a known section" proves nothing on its
    // own. A test placed where discovery does not scan fails here.
    const discovered = new Set(files.map((f) => f.path));
    const orphans = findAllTestFiles()
      .filter((f) => !discovered.has(f))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(orphans).toEqual([]);
  });

  it("reaches every test file by some section+kind selection", () => {
    const unreachable = findUnreachable(files).map((f) => f.path.replace(ROOT + "/", ""));
    expect(unreachable).toEqual([]);
  });

  it("assigns every file exactly one kind", () => {
    const miskinded = files.filter(
      (f) => KNOWN_KINDS.filter((k) => matchesKind(f.path, [k])).length !== 1
    );
    expect(miskinded.map((f) => f.path.replace(ROOT + "/", ""))).toEqual([]);
  });

  it("covers in-package tests, not just the monolithic test package", () => {
    // The previous runner selected zero of these, so they never ran in CI.
    const inPackage = files.filter((f) => !f.path.includes("/packages/test/src/"));
    expect(inPackage.length).toBeGreaterThan(0);
  });

  it("maps every grouped directory to a section that still exists", () => {
    // A directory renamed or deleted without updating SECTION_GROUPS leaves a
    // dangling entry — harmless today, misleading later.
    const sections = new Set(listSections(files));
    const dangling = Object.keys(SECTION_GROUPS).filter((s) => !sections.has(s));
    expect(dangling).toEqual([]);
  });
});

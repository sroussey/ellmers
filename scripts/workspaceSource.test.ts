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
import type { UnresolvedWorkspaceContext, WorkspacePackage } from "./lib/workspaceSource";
import {
  distToSource,
  listWorkspacePackages,
  ownerOf,
  resolveTestTarget,
  TEST_TARGETS,
  unresolvedWorkspaceMessage,
  WORKSPACE_GROUPS,
} from "./lib/workspaceSource";

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

  /**
   * The invariant that actually broke: the resolver covers all three workspace
   * groups, but the coverage denominator listed only two, so `examples/*`
   * source was rewritten to `src`, executed by its own tests, and then left out
   * of the denominator entirely. All three example packages are published and
   * none is `private`, so there is no "not really shipped" argument for the
   * omission — and a missing group is invisible in a coverage report, which
   * shows a smaller file list rather than an error.
   *
   * Reads the ACTUAL config rather than re-deriving it, so the two cannot drift
   * back apart.
   */
  it("counts every workspace group in the coverage denominator", async () => {
    const mod = (await import("../vitest.config.ts")) as {
      default: { test?: { coverage?: { include?: string[] } } };
    };
    const include = mod.default.test?.coverage?.include ?? [];
    const missing = WORKSPACE_GROUPS.filter(
      (group) => !include.some((glob) => glob.startsWith(`${group}/`))
    );
    expect(missing).toEqual([]);
  });

  /**
   * `resolveId` itself needs Vite's plugin context to drive, so the owner
   * lookup and the message are separated out and tested directly. The lookup is
   * what makes an actionable message possible at all: the old plugin kept only
   * package NAMES, so at the point resolution failed it could not say which
   * package's `dist` to look at.
   */
  describe("owner lookup", () => {
    it("attributes a subpath specifier to its package", () => {
      expect(ownerOf(packages, "@workglow/util/schema")?.name).toBe("@workglow/util");
      expect(ownerOf(packages, "@workglow/util")?.name).toBe("@workglow/util");
    });

    it("matches on the package boundary, not a string prefix", () => {
      // `@workglow/util` is a string prefix of this, but the specifier belongs
      // to no package — attributing it would point the diagnostic at an
      // unrelated directory.
      expect(ownerOf(packages, "@workglow/utilities")).toBeUndefined();
      expect(ownerOf(packages, "vitest")).toBeUndefined();
    });
  });

  describe("unresolved specifier diagnostic", () => {
    const owner: WorkspacePackage = {
      name: "@workglow/ai",
      dir: "/repo/packages/ai",
      exports: { ".": "./dist/node.js", "./worker": "./dist/worker.js" },
      dependencies: new Set<string>(),
    };
    const importerPackage: WorkspacePackage = {
      name: "@workglow/huggingface-transformers",
      dir: "/repo/providers/hft",
      exports: { "./ai": "./dist/ai.js" },
      dependencies: new Set(["@workglow/ai"]),
    };

    /** The healthy case for every input the ranking does not exercise. */
    function context(overrides: Partial<UnresolvedWorkspaceContext>): UnresolvedWorkspaceContext {
      return {
        source: "@workglow/ai/worker",
        owner,
        importer: undefined,
        importerPackage: undefined,
        importerDeclaresDependency: undefined,
        ownerDeclaresSubpath: true,
        distHasBuiltEntries: false,
        ...overrides,
      };
    }

    it("names the specifier, the owning package and the importer", () => {
      const message = unresolvedWorkspaceMessage(
        context({ importer: "/repo/providers/hft/src/x.ts" })
      );
      expect(message).toContain("@workglow/ai/worker");
      expect(message).toContain("@workglow/ai");
      expect(message).toContain("/repo/providers/hft/src/x.ts");
      expect(message).toContain("workglow:workspace-source");
    });

    // The two cases need opposite responses, so they must not read the same.
    it("distinguishes a never-built package from a stale dist", () => {
      const neverBuilt = unresolvedWorkspaceMessage(context({ distHasBuiltEntries: false }));
      const staleDist = unresolvedWorkspaceMessage(context({ distHasBuiltEntries: true }));

      expect(neverBuilt).toContain("missing or empty");
      expect(neverBuilt).toContain("never been built");
      // "run build" alone would read as wrong advice to someone looking at a
      // populated dist directory, so the stale case has to say why.
      expect(staleDist).toContain("carries built entries but none for this specifier");
      expect(staleDist).toContain("stale rather than absent");
      expect(staleDist).not.toContain("never been built");
    });

    it("omits the importer clause when there is no importer", () => {
      expect(unresolvedWorkspaceMessage(context({ distHasBuiltEntries: true }))).not.toContain(
        "imported from"
      );
    });

    /**
     * Resolution fails from the IMPORTER's `node_modules`, and under isolated
     * linking that is a different question from whether the owner is built. A
     * fully populated dist is the normal state in these two cases, so offering
     * the built/stale pair is confident, wrong advice: it names a directory
     * that is fine and a rebuild that changes nothing.
     */
    it("blames an undeclared dependency before the owner's dist", () => {
      const message = unresolvedWorkspaceMessage(
        context({
          importer: "/repo/providers/hft/src/x.ts",
          importerPackage: { ...importerPackage, dependencies: new Set<string>() },
          importerDeclaresDependency: false,
          // The owner is built and exports the subpath — nothing to fix there.
          distHasBuiltEntries: true,
        })
      );

      expect(message).toContain("isolated");
      expect(message).toContain("@workglow/huggingface-transformers");
      expect(message).toContain("bun i");
      expect(message).not.toContain("stale rather than absent");
      expect(message).not.toContain("never been built");
    });

    it("blames an undeclared subpath before the owner's dist", () => {
      const message = unresolvedWorkspaceMessage(
        context({
          source: "@workglow/ai/capability",
          importerPackage,
          importerDeclaresDependency: true,
          ownerDeclaresSubpath: false,
          distHasBuiltEntries: true,
        })
      );

      expect(message).toContain('"exports" does not declare this subpath');
      expect(message).toContain("missing from the manifest, not from the build output");
      expect(message).not.toContain("stale rather than absent");
    });

    it("falls back to the built/stale pair once the earlier causes are ruled out", () => {
      const message = unresolvedWorkspaceMessage(
        context({
          importerPackage,
          importerDeclaresDependency: true,
          ownerDeclaresSubpath: true,
          distHasBuiltEntries: true,
        })
      );
      expect(message).toContain("The remaining likely cause");
      expect(message).toContain("stale rather than absent");
    });

    it("does not read an importer outside any workspace as an undeclared dependency", () => {
      // `undefined` is "the question does not apply", not "no".
      const message = unresolvedWorkspaceMessage(
        context({ importer: "/repo/vitest.config.ts", distHasBuiltEntries: true })
      );
      expect(message).not.toContain("isolated");
      expect(message).toContain("stale rather than absent");
    });
  });

  /**
   * `WORKGLOW_TEST_TARGET` had two independent readers, each treating anything
   * that was not literally `"dist"` as source. A workflow edited to `"dist "`
   * or `Dist` turned the dist job into a byte-identical rerun of the source
   * job — green, a runner slot spent, and no bundle coverage at all.
   */
  describe("resolveTestTarget", () => {
    it("defaults to source when unset or empty", () => {
      expect(resolveTestTarget(undefined)).toBe("source");
      expect(resolveTestTarget("")).toBe("source");
    });

    it("accepts every declared target", () => {
      for (const target of TEST_TARGETS) expect(resolveTestTarget(target)).toBe(target);
    });

    it("throws on anything else, naming the offending value", () => {
      // No lowercasing and no prefix matching: reinterpreting a typo is the
      // failure being fixed, not a fix for it.
      for (const raw of ["dist ", "Dist", "1"]) {
        expect(() => resolveTestTarget(raw)).toThrow(`WORKGLOW_TEST_TARGET="${raw}"`);
      }
    });
  });
});

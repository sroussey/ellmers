/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCE_STUB_SENTINEL, stubSpecsFor, type PackageManifest } from "./lib/sourceStubs";
import { ROOT } from "./lib/testDiscovery";
import { coverageIncludeGlobs, workspaceGroups } from "./lib/workspaceGroups";
import type {
  UnresolvedWorkspaceContext,
  WorkspacePackage,
  WorkspaceResolveContext,
  WorkspaceResolvedId,
  WorkspaceResolveOptions,
} from "./lib/workspaceSource";
import {
  assertNoSourceStubs,
  distToSource,
  listWorkspacePackages,
  ownerOf,
  resolveTestTarget,
  resolveWorkspaceSourceId,
  TEST_TARGETS,
  unresolvedWorkspaceMessage,
  WORKSPACE_SOURCE_PLUGIN_NAME,
  workspaceSourcePlugin,
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
   * The workspace groups, and what the coverage denominator is built from.
   *
   * The invariant that actually broke: the resolver covered all three groups
   * while the denominator listed two, so `examples/*` source was rewritten to
   * `src`, executed by its own tests, and then left out of the report entirely
   * — invisible, because a coverage report shows a shorter file list rather
   * than an error. The same list was written out by hand in four places.
   *
   * The guard that used to sit here ("every group in `WORKSPACE_GROUPS` appears
   * in `coverage.include`") is tautological now that both sides derive from the
   * root manifest, and its stated goal — fail when a group is added to
   * `package.json` and nowhere else — is no longer satisfiable in the literal
   * sense: with derivation, nowhere else NEEDS the change. What is still worth
   * guarding is that the derivation is real and reaches something: that nobody
   * hardcodes the list back, that every declared group actually holds packages,
   * and that the denominator is built from those same groups and not from a
   * hand-edited glob.
   */
  describe("workspace groups", () => {
    it("derives the groups from the root workspaces field, not from a list", () => {
      // Parsed independently HERE, so the test does not merely re-run the code
      // it is checking. Hardcoding the array back into `workspaceGroups` — the
      // exact regression this file exists to prevent — fails the moment a
      // fourth group is declared, and reads as a deliberate contradiction now.
      const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
        workspaces: string[];
      };
      const expected = manifest.workspaces.map((pattern) =>
        pattern.replace(/^\.\//, "").replace(/\/?\*.*$/, "")
      );
      expect(workspaceGroups(ROOT)).toEqual(expected);
    });

    it("finds at least one package in every declared workspace group", () => {
      // Catches the other half: a pattern the reduction mishandles, or a
      // directory renamed in the tree but not in the manifest, yields a group
      // name that scans to nothing. Every walk downstream then silently covers
      // one group fewer.
      const empty = workspaceGroups(ROOT).filter(
        (group) => !packages.some((pkg) => pkg.dir.startsWith(join(ROOT, group) + "/"))
      );
      expect(empty).toEqual([]);
    });

    it("builds the coverage denominator from those same groups", async () => {
      // Compared EXACTLY, not by prefix: a hand-edited or hand-appended glob is
      // precisely how the two drifted apart the first time, and a `startsWith`
      // check passes over a narrowed one.
      const mod = (await import("../vitest.config.ts")) as {
        default: { test?: { coverage?: { include?: string[] } } };
      };
      expect(mod.default.test?.coverage?.include).toEqual(
        coverageIncludeGlobs(workspaceGroups(ROOT))
      );
    });

    /**
     * The reduction's own contract, on a fixture rather than on this repo — the
     * real manifest exercises exactly one pattern shape, so nothing here would
     * otherwise pin what happens to the others.
     */
    it("reduces each declared pattern to one scannable directory", () => {
      const root = mkdtempSync(join(tmpdir(), "workglow-groups-"));
      try {
        writeFileSync(
          join(root, "package.json"),
          JSON.stringify({ workspaces: ["./packages/*", "./integrations/*"] })
        );
        expect(workspaceGroups(root)).toEqual(["packages", "integrations"]);

        // A recursive pattern names no single directory to read. Guessing its
        // prefix would walk the wrong tree and report nothing missing, which is
        // the same silent no-op the derivation exists to remove.
        writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["./a/**/c"] }));
        expect(() => workspaceGroups(root)).toThrow(/more than one directory depth/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("distinguishes a malformed manifest from a non-package directory", () => {
      // `listWorkspacePackages` swallowed every read failure alike. A directory
      // with no `package.json` is the ordinary case and must stay silent; a
      // manifest that fails to parse is a real fault, and dropping the package
      // silently makes the source rewrite no-op for it — whose only symptom is
      // that one package's coverage collapses back onto `dist/*`.
      const root = mkdtempSync(join(tmpdir(), "workglow-manifest-"));
      try {
        writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["./packages/*"] }));

        // Declared group that does not exist on disk: no packages, no error.
        expect(listWorkspacePackages(root)).toEqual([]);

        const brokenDir = join(root, "packages", "broken");
        mkdirSync(brokenDir, { recursive: true });
        writeFileSync(join(brokenDir, "package.json"), "{ not json");
        expect(() => listWorkspacePackages(root)).toThrow(join(brokenDir, "package.json"));

        // And a sibling with no manifest at all is still just "not a package".
        rmSync(join(brokenDir, "package.json"));
        expect(listWorkspacePackages(root)).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  /**
   * Which PACKAGES the denominator counts, as opposed to which groups it walks.
   *
   * `examples/web` declares `publishConfig.access: "none"`, `exports: {}`, and
   * neither `main` nor `bin`: it is a Vite app, and none of its ~34 non-test
   * modules is reachable as published API. Counting them moves the repo's
   * headline number without saying anything about the libraries. (The comment
   * that used to sit here claimed all three example packages were published,
   * which was simply false.)
   */
  describe("coverage denominator membership", () => {
    async function coverageExclude(): Promise<string[]> {
      const mod = (await import("../vitest.config.ts")) as {
        default: { test?: { coverage?: { exclude?: string[] } } };
      };
      return mod.default.test?.coverage?.exclude ?? [];
    }

    it("keeps packages that publish nothing out of the denominator", async () => {
      const exclude = await coverageExclude();
      expect(exclude).toContain("examples/web/src/**");

      // Pinned to the PROPERTY that justifies the exclusion, re-read from the
      // manifest, so the exception dies with its reason: publish `@workglow/web`
      // for real and this test demands the exclusion be removed.
      const manifest = JSON.parse(
        readFileSync(join(ROOT, "examples/web/package.json"), "utf8")
      ) as { publishConfig?: { access?: string } };
      expect(manifest.publishConfig?.access).toBe("none");
    });

    it("counts every package that does publish", async () => {
      // The gate is `access: "none"`, NOT `private`. `packages/test`,
      // `providers/aws` and `providers/cloudflare` are `private: true`, and the
      // last two carry real suites whose source has to stay counted — gating on
      // `private` would silently drop them.
      const exclude = await coverageExclude();
      const wronglyExcluded = packages
        .filter((pkg) => pkg.publishes)
        .map((pkg) => `${pkg.dir.slice(ROOT.length + 1)}/src/**`)
        .filter((glob) => exclude.includes(glob));
      expect(wronglyExcluded).toEqual([]);
    });
  });

  /**
   * The hook the whole module exists for. Every case below was previously
   * unreachable from any test: `resolveId` lived inside a `Plugin` object
   * literal, so driving it needed a Vite build, and both CI modes pass under
   * either resolution — `test-vitest-unit` and `test-vitest-dist` run the same
   * files and the same assertions, differing only in which files load. Nothing
   * distinguished "resolved to src" from "resolved to dist".
   *
   * `resolveWorkspaceSourceId` takes the plugin context as a parameter for
   * exactly this reason, so a recording stub can stand in for Vite.
   */
  describe("resolveId", () => {
    interface RecordedResolve {
      readonly source: string;
      readonly importer: string | undefined;
      readonly options: WorkspaceResolveOptions;
    }

    /** A plugin context that answers with `result` and records every call. */
    function recordingContext(result: WorkspaceResolvedId | null): {
      readonly calls: RecordedResolve[];
      readonly context: WorkspaceResolveContext;
    } {
      const calls: RecordedResolve[] = [];
      return {
        calls,
        context: {
          async resolve(source, importer, options) {
            calls.push({ source, importer, options });
            return result;
          },
        },
      };
    }

    it("rewrites a resolved dist entry to its source twin", async () => {
      const { calls, context } = recordingContext({ id: join(ROOT, "packages/ai/dist/node.js") });

      const resolved = await resolveWorkspaceSourceId(
        packages,
        context,
        "@workglow/ai",
        undefined,
        {}
      );

      expect(resolved?.id).toBe(join(ROOT, "packages/ai/src/node.ts"));
      expect(calls).toHaveLength(1);
    });

    it("passes a non-workspace specifier through without resolving it", async () => {
      // Resolving every third-party specifier a second time would tax the whole
      // run for nothing, so the owner lookup has to short-circuit BEFORE the
      // `this.resolve` round trip rather than after it.
      const { calls, context } = recordingContext({ id: "/elsewhere/vitest.js" });

      expect(await resolveWorkspaceSourceId(packages, context, "vitest", undefined, {})).toBeNull();
      expect(calls).toEqual([]);
    });

    it("leaves an external resolution as it was resolved", async () => {
      // A source twin exists for this id, so only the externality check stops
      // the rewrite: rewriting an external id to an absolute source path would
      // pull a module the resolver deliberately left out back into the graph.
      const external = { id: join(ROOT, "packages/ai/dist/node.js"), external: true };
      const { context } = recordingContext(external);

      expect(await resolveWorkspaceSourceId(packages, context, "@workglow/ai", undefined, {})).toBe(
        external
      );
    });

    it("leaves build output with no source twin on the built file", async () => {
      const generated = { id: join(ROOT, "packages/ai/dist/not-a-real-entry.js") };
      expect(existsSync(generated.id)).toBe(false);
      const { context } = recordingContext(generated);

      expect(await resolveWorkspaceSourceId(packages, context, "@workglow/ai", undefined, {})).toBe(
        generated
      );
    });

    it("throws the workspace diagnostic when resolution yields nothing", async () => {
      // The branch the diagnostic exists for, and the one with zero execution
      // anywhere else: `unresolvedWorkspaceMessage` is unit-tested on its
      // inputs, but nothing proved the hook ever calls it.
      const { context } = recordingContext(null);

      await expect(
        resolveWorkspaceSourceId(
          packages,
          context,
          "@workglow/ai/not-exported",
          join(ROOT, "packages/test/src/x.ts"),
          {}
        )
      ).rejects.toThrow(
        /\[workglow:workspace-source\] cannot resolve "@workglow\/ai\/not-exported"/
      );
    });

    it("forwards the hook's options and adds skipSelf", async () => {
      // Without `skipSelf` this plugin re-enters itself and resolution never
      // terminates; the rest of the options (`kind`, `isEntry`, `custom`) steer
      // which conditional export is picked, so dropping them silently changes
      // the target that then gets rewritten.
      const { calls, context } = recordingContext({ id: join(ROOT, "packages/ai/dist/node.js") });
      const importer = join(ROOT, "packages/test/src/x.ts");

      await resolveWorkspaceSourceId(packages, context, "@workglow/ai", importer, {
        isEntry: false,
        kind: "import-statement",
      });

      expect(calls).toEqual([
        {
          source: "@workglow/ai",
          importer,
          options: { isEntry: false, kind: "import-statement", skipSelf: true },
        },
      ]);
    });
  });

  /**
   * The rewrite only takes effect where the plugin is ATTACHED, and it has to
   * be attached per project: projects are standalone Vite configs, so a
   * root-level `plugins` entry never reaches them. Hoisting the plugin to the
   * root `defineConfig` — a natural "one instance instead of N" cleanup — is
   * silent: every project resolves through `exports` to dist again, all tests
   * still pass, and the only symptom is entry-point behavior reading as
   * uncovered.
   *
   * Both directions stub the variable EXPLICITLY. `test-vitest-dist` runs this
   * file with `WORKGLOW_TEST_TARGET=dist` ambient, so a test that read the
   * ambient value would pass in one CI job and fail in the other.
   */
  describe("plugin attachment", () => {
    interface ConfiguredProject {
      readonly plugins?: readonly { readonly name?: string }[];
    }

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    async function projectsForTarget(target: string): Promise<readonly ConfiguredProject[]> {
      vi.stubEnv("WORKGLOW_TEST_TARGET", target);
      // The config reads the variable at module scope, so a cached evaluation
      // would answer for whichever target ran first.
      vi.resetModules();
      const mod = (await import("../vitest.config.ts")) as {
        default: { test?: { projects?: readonly ConfiguredProject[] } };
      };
      const projects = mod.default.test?.projects ?? [];
      // A zero-project config would satisfy "none is missing the plugin".
      expect(projects.length).toBeGreaterThan(0);
      return projects;
    }

    const carriesPlugin = (project: ConfiguredProject): boolean =>
      (project.plugins ?? []).some((plugin) => plugin?.name === WORKSPACE_SOURCE_PLUGIN_NAME);

    it("attaches the source rewrite to every project under the default target", async () => {
      const projects = await projectsForTarget("source");
      expect(projects.filter((project) => !carriesPlugin(project))).toEqual([]);
    });

    it("attaches it to no project when the target is dist", async () => {
      const projects = await projectsForTarget("dist");
      expect(projects.filter(carriesPlugin)).toEqual([]);
    });

    it("attaches one plugin instance to every project", async () => {
      // The only thing stopping the hoist being undone. Constructing the plugin
      // inside the project `.map()` re-scanned every workspace manifest once
      // per project — 12 projects x 41 manifests today, ~500 file reads at
      // config load, for an answer that cannot differ between projects — and
      // nothing about the result changes, so nothing else would catch it.
      //
      // Reference equality, not "same name": a per-project instance passes any
      // name-based check.
      const projects = await projectsForTarget("source");
      const instances = new Set(projects.map((project) => project.plugins?.[0]));
      expect(instances.size).toBe(1);
      expect([...instances][0]).toBeDefined();
    });

    it("names the plugin the same thing the diagnostic does", () => {
      expect(workspaceSourcePlugin(ROOT).name).toBe(WORKSPACE_SOURCE_PLUGIN_NAME);
      expect(
        unresolvedWorkspaceMessage({
          source: "@workglow/ai",
          owner: {
            name: "@workglow/ai",
            dir: "/repo/packages/ai",
            exports: undefined,
            dependencies: new Set(),
            publishes: true,
          },
          importer: undefined,
          importerPackage: undefined,
          importerDeclaresDependency: undefined,
          ownerDeclaresSubpath: true,
          distHasBuiltEntries: true,
        })
      ).toContain(`[${WORKSPACE_SOURCE_PLUGIN_NAME}]`);
    });
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
      publishes: true,
    };
    const importerPackage: WorkspacePackage = {
      name: "@workglow/huggingface-transformers",
      dir: "/repo/providers/hft",
      exports: { "./ai": "./dist/ai.js" },
      dependencies: new Set(["@workglow/ai"]),
      publishes: true,
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

  /**
   * The `dist` target's own precondition.
   *
   * A `use-source` stub makes `dist/node.js` re-export `src/node.ts`, so under
   * a stubbed tree `@workglow/ai` and `@workglow/ai/worker` collapse onto ONE
   * source module: every cross-entry `instanceof` succeeds trivially and an
   * export-name parity check compares a file with itself. The dist job then
   * reports a clean pass over bundles it never loaded, which is worse than not
   * running it. `vitest.config.ts` calls this at config load so the whole run
   * dies before a suite can report that pass.
   */
  describe("assertNoSourceStubs", () => {
    /** A workspace package rooted in a scratch dir, with `exports` on disk. */
    function fixturePackage(
      dir: string,
      entries: Record<string, string>
    ): { pkg: WorkspacePackage; files: Record<string, string> } {
      mkdirSync(join(dir, "dist"), { recursive: true });
      const files: Record<string, string> = {};
      for (const [target, body] of Object.entries(entries)) {
        const file = join(dir, target);
        writeFileSync(file, body);
        files[target] = file;
      }
      return {
        pkg: {
          name: "@workglow/fixture",
          dir,
          exports: Object.fromEntries(Object.keys(entries).map((t, i) => [i === 0 ? "." : t, t])),
          dependencies: new Set<string>(),
          publishes: true,
        },
        files,
      };
    }

    it("throws naming the stub, and points at use-dist", () => {
      const root = mkdtempSync(join(tmpdir(), "workglow-stubs-"));
      try {
        const { pkg, files } = fixturePackage(root, {
          "./dist/node.js": `// ${SOURCE_STUB_SENTINEL}: generated by \`use-source\`.\nexport * from "../src/node.ts";\n`,
        });
        expect(() => assertNoSourceStubs([pkg])).toThrow(files["./dist/node.js"]!);
        expect(() => assertNoSourceStubs([pkg])).toThrow("use-dist");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("passes a real-looking bundle, and a dist entry that is simply absent", () => {
      const root = mkdtempSync(join(tmpdir(), "workglow-stubs-"));
      try {
        // Real build output mentions neither the sentinel nor `use-source`.
        const { pkg } = fixturePackage(root, {
          "./dist/node.js": `var x=1;export{x as node};\n//# sourceMappingURL=node.js.map\n`,
        });
        expect(() => assertNoSourceStubs([pkg])).not.toThrow();

        // A package whose `exports` names an entry that was never built is not
        // this guard's business — resolution fails with its own diagnostic.
        const unbuilt: WorkspacePackage = {
          ...pkg,
          exports: { ".": "./dist/node.js", "./worker": "./dist/worker.js" },
        };
        expect(() => assertNoSourceStubs([unbuilt])).not.toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("reports every offender at once", () => {
      // A developer who ran `use-source` stubbed all 41 packages. Failing on
      // the first would take 41 fix-and-rerun cycles to learn one fact.
      const root = mkdtempSync(join(tmpdir(), "workglow-stubs-"));
      try {
        const stub = `// ${SOURCE_STUB_SENTINEL}\nexport * from "../src/node";\n`;
        const a = fixturePackage(join(root, "a"), { "./dist/node.js": stub });
        const b = fixturePackage(join(root, "b"), { "./dist/browser.js": stub });
        let message = "";
        try {
          assertNoSourceStubs([a.pkg, b.pkg]);
        } catch (error) {
          message = String(error);
        }
        expect(message).toContain(a.files["./dist/node.js"]!);
        expect(message).toContain(b.files["./dist/browser.js"]!);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

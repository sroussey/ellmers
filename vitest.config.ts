import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
// Extension is required: Vite's native config loader cannot resolve an
// extensionless relative import here.
import { discoverTestFiles, listTestProjects } from "./scripts/lib/testDiscovery.ts";
import { coverageIncludeGlobs, workspaceGroups } from "./scripts/lib/workspaceGroups.ts";
import {
  listWorkspacePackages,
  resolveTestTarget,
  sourceStubGuardPlugin,
  workspaceSourcePlugin,
} from "./scripts/lib/workspaceSource.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const abs = (p: string): string => path.join(__dirname, p);

/**
 * Tier gate for callers that do NOT pre-select files — `turbo run test` and a
 * bare `vitest run --project <name>`. Those would otherwise mean "every tier",
 * including the integration suites that want databases and live API keys, which
 * is the wrong default for a per-package script.
 *
 * `scripts/test.ts` sets `all` when it spawns vitest, because it has already
 * applied the requested kind filter and hands over an explicit file list — an
 * exclude here would silently drop files the caller asked for by name. It sets
 * `e2e` only when the caller named the `end2end` kind: e2e files cost money and
 * multi-GB downloads, so they stay excluded from every other tier — including
 * `--all` — but a run that asks for them by name must not resolve to zero files.
 */
const tier = process.env.WORKGLOW_TEST_TIER ?? "unit";
const tierExclude =
  tier === "e2e"
    ? []
    : tier === "all"
      ? ["**/*.e2e.test.ts"]
      : ["**/*.integration.test.ts", "**/*.e2e.test.ts"];

/**
 * Which build of the workspace packages a vitest run exercises.
 *
 * `source` (the default) resolves every `@workglow/*` specifier to the
 * package's `src`, so a cross-package suite runs the same files a co-located
 * `__tests__` does. That is what makes coverage mean anything: with the
 * bundles in play, `packages/test` exercises `packages/ai/dist/node.js` and
 * v8 attributes every executed line there, leaving `packages/ai/src/**`
 * reading as untested. It also collapses the two module identities a mixed
 * package/relative import graph otherwise produces.
 *
 * `dist` restores the old behavior for the check that the built bundles
 * themselves are wired correctly. The plugin below is attached to every project
 * unconditionally, so under the default NO vitest run resolves a `@workglow/*`
 * specifier through `exports`. The nightly Bun parity workflow does, but it is
 * informational and never blocks a merge, so the blocking guard is the
 * `test-vitest-dist` CI job, which runs `bun run test:vitest:dist`.
 */
const target = resolveTestTarget(process.env.WORKGLOW_TEST_TARGET);
const testsRunAgainstSource = target !== "dist";

/**
 * Options every project needs. Project roots differ, so anything path-shaped
 * here must be ABSOLUTE — a relative `setupFiles` or `typecheck.tsconfig` would
 * resolve against each project's own root and silently fail to load.
 */
const shared = {
  /**
   * The VALIDATED target, handed to the workers.
   *
   * A test that needs to know which build it is exercising cannot re-derive
   * this: `packages/test` is a composite program rooted at `./src` and cannot
   * import `scripts/lib/*`, so re-implementing the `=== "dist"` comparison
   * there would reintroduce exactly the silent-typo bug `resolveTestTarget`
   * exists to remove. Passing the resolved value down means there is one
   * definition of the target for the config and every suite alike.
   */
  env: { WORKGLOW_TEST_TARGET: target },
  setupFiles: [abs("vitest.setup.ts")],
  // The nightly type-drift guard runs `.test-d.ts` files through vitest's
  // `--typecheck` engine. Scope the tsc program to the package under test so
  // unrelated source (example UIs needing `jsx`, providers relying on their
  // own ambient `types`/`lib`) is not swept in and reported as drift.
  typecheck: {
    tsconfig: abs("tsconfig.typecheck.json"),
  },
  testTimeout: 15000, // 15 second global timeout (WASM Postgres / PGlite init can be slow)
  // Vitest uses hookTimeout for beforeEach/afterAll separately from testTimeout; keep both aligned
  hookTimeout: 15000,
  retry: 1,
  exclude: [...configDefaults.exclude, ...tierExclude],
};

const discovered = discoverTestFiles();

/**
 * The workspace scan and the plugin are BOTH hoisted out of the project map
 * below, and shared by every project.
 *
 * The plugin is stateless — every decision lives in `resolveWorkspaceSourceId`,
 * over a package list that cannot differ between projects — so one instance
 * serves all of them. Constructing it inside the map re-read every workspace
 * manifest once per project: 12 projects x 41 manifests today, so ~500 file
 * reads before a single test ran, for an answer identical every time.
 *
 * The package list is also what the coverage `exclude` below subtracts
 * non-publishing workspaces from, so it is read exactly once for both uses.
 */
const workspacePackages = listWorkspacePackages(__dirname);
const sourcePlugin = workspaceSourcePlugin(__dirname, workspacePackages);

/**
 * What every project's `plugins` gets, decided once.
 *
 * Under the `dist` target the guard refuses to run at all against a stubbed
 * `dist`: a stub re-exports `src`, so every bundle-shaped assertion passes for
 * the wrong reason and the job reports a clean sweep over bundles it never
 * loaded. That check is a plugin HOOK rather than a side effect of loading this
 * module, because this module is ordinarily importable —
 * `scripts/workspaceSource.test.ts` imports it with `WORKGLOW_TEST_TARGET`
 * stubbed to `dist` to check attachment, and `scripts/*.test.ts` is unit-tier,
 * so scanning at import time made an ordinary unit run on a `use-source` tree
 * die with advice to run `use-dist` and undo the dev mode it never left. Vitest
 * resolves every project's config at startup, so the hook still fires before
 * any suite can report a false pass.
 */
const projectPlugins = testsRunAgainstSource
  ? [sourcePlugin]
  : [sourceStubGuardPlugin(workspacePackages)];

/**
 * One project per workspace that actually holds tests, derived from the same
 * discovery the runner and the reachability guard use. Deriving rather than
 * enumerating is the point: a hand-written list drifts, and a test file under
 * no project root does not merely become unselectable — it stops running
 * entirely, with nothing in the output to say so. `testDiscovery.test.ts` reads
 * this config back and fails if a discovered file falls outside every root.
 *
 * Each project also excludes the `bun:test` files under its root. Those use
 * Bun-only APIs and cannot run under vitest at all — `scripts/test.test.ts`
 * imports `bun:test` and fails to even load. The runner filters them out of its
 * own selection, but `vitest run --project <name>` bypasses the runner, so the
 * exclusion has to live here too or that command fails on a healthy tree.
 */
const projects = listTestProjects(discovered).map((p) => {
  const root = abs(p.dir);
  const bunOnly = discovered
    .filter((f) => f.runner === "bun" && f.path.startsWith(root + "/"))
    .map((f) => f.path.slice(root.length + 1));
  return {
    // Projects are standalone Vite configs, so a root-level `plugins` entry
    // would never reach them — the resolver has to be attached per project.
    plugins: [...projectPlugins],
    test: { ...shared, name: p.name, root, exclude: [...shared.exclude, ...bunOnly] },
  };
});

export default defineConfig({
  envDir: __dirname,
  test: {
    projects,
    coverage: {
      provider: "v8", // or 'istanbul'
      reporter: ["text", "json", "json-summary", "html"],
      // There is deliberately no `root` here. Vitest 4 has no such coverage
      // option — its own types reject it, and its provider derives the roots it
      // globs from the resolved PROJECT configs, never from the coverage block
      // — so the key was inert. The `include` globs below are matched against
      // absolute filenames with `contains: true`, which is what actually makes
      // them work from a package directory.
      /**
       * The denominator is every package's own `src`, stated explicitly. Left
       * to vitest's default (files loaded during the run), a package's score
       * silently omits the modules no test imports at all — the ones a coverage
       * report exists to surface — and its file list changes with whichever
       * section CI happened to run.
       *
       * EVERY workspace group, derived from the root manifest's `workspaces`
       * field — the same derivation the source-resolving plugin and the test
       * discovery walk use. A group the resolver rewrites to `src` but the
       * denominator omits has its source executed by its own tests and then
       * left out of the report, which shows up as a shorter file list rather
       * than an error. Individual packages are subtracted below, by name, so
       * every exception carries its own reason instead of being hidden in a
       * shortened glob.
       */
      include: coverageIncludeGlobs(__dirname, workspaceGroups(__dirname)),
      exclude: [
        // `coverageConfigDefaults`, not `configDefaults`: the latter is
        // vitest's TEST-FILE exclude list, spliced in here for a question it
        // does not answer. It is empty in vitest 4 — which is precisely why the
        // two must not be confused, since `configDefaults.exclude` is NOT, and
        // the difference between them was silently supplying the two entries
        // restated on the next line.
        ...coverageConfigDefaults.exclude,
        "**/node_modules/**",
        "**/.git/**",
        // Built output is never the unit of measure. Nothing should resolve
        // here now that specifiers land on `src`, but a `use-source` stub or a
        // stale bundle left in a working tree would otherwise be reported as a
        // source file of its own.
        "**/dist/**",
        // The cross-package suite is the harness, not the subject.
        "packages/test/**",
        // The examples keep their suites in `src/test`, which also holds the
        // odd non-`.test.` helper (`chromeAvailability.ts`) that the filename
        // rules below cannot catch.
        "examples/*/src/test/**",
        /**
         * Workspaces that publish nothing (`publishConfig.access: "none"`).
         * Today that is only `examples/web`, a Vite app whose ~34 non-test
         * modules are UI wiring behind no published entry point: it exports
         * nothing, has no `main` and no `bin`, so none of that source is API
         * anyone can consume, and counting it moves the repo's headline number
         * without saying anything about the libraries.
         *
         * The gate is `access: "none"`, deliberately NOT `private`.
         * `packages/test`, `providers/aws` and `providers/cloudflare` are all
         * `private: true` and aws/cloudflare carry real suites whose source has
         * to stay counted.
         *
         * Subtracted by package path rather than by shortening the `include`
         * globs above, so the group list stays derived and this exception
         * carries its own reason.
         */
        ...workspacePackages.filter((pkg) => !pkg.publishes).map((pkg) => `${pkg.dir}/src/**`),
        // Tests, fixtures and typing-only files: counting them inflates every
        // package by the coverage of code that exists to be run.
        //
        // `**/testing/**` is deliberately NOT here. Those directories are
        // published API — `@workglow/task-graph/test` and `@workglow/util/test`
        // ship the repository contracts, the shared fake tasks and the testing
        // logger that other packages' suites import by specifier — so excluding
        // them dropped 11 real source files from the denominator. The one test
        // file among them is removed by `**/__tests__/**` below.
        "**/__tests__/**",
        "**/*.test.*",
        "**/*.test-d.ts",
        "**/*.d.ts",
        "**/bench/**",
      ],
    },
  },
});

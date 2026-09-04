import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
// Extension is required: Vite's native config loader cannot resolve an
// extensionless relative import here.
import { discoverTestFiles, listTestProjects } from "./scripts/lib/testDiscovery.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const abs = (p: string): string => path.join(__dirname, p);

/**
 * Vitest's workspace `cliOverrides` whitelist does not include `typecheck`,
 * so `--typecheck` / `--typecheck.only` never reach `test.projects`. Read the
 * flags from argv and enable typecheck on the `ai` project, or the nightly
 * drift guard (`vitest run --typecheck --typecheck.only <file.test-d.ts>`)
 * collects zero files.
 */
export function typecheckFromArgv(argv: readonly string[]): {
  readonly enabled: boolean;
  readonly only: boolean;
} {
  const only = argv.includes("--typecheck.only");
  const enabled = only || argv.includes("--typecheck") || argv.includes("--typecheck.enabled");
  return { enabled, only };
}

const typecheckCli = typecheckFromArgv(process.argv);

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
 * Options every project needs. Project roots differ, so anything path-shaped
 * here must be ABSOLUTE — a relative `setupFiles` or `typecheck.tsconfig` would
 * resolve against each project's own root and silently fail to load.
 */
const shared = {
  setupFiles: [abs("vitest.setup.ts")],
  // The nightly type-drift guard runs `.test-d.ts` files through vitest's
  // `--typecheck` engine. Scope the tsc program to the package under test so
  // unrelated source (example UIs needing `jsx`, providers relying on their
  // own ambient `types`/`lib`) is not swept in and reported as drift.
  // `enabled`/`only` come from argv: see {@link typecheckFromArgv}. The
  // tsconfig only includes `packages/ai/src`, so only the `ai` project turns
  // typecheck on — other projects would glob their own `.test-d.ts` files
  // into a program that does not contain them.
  typecheck: {
    enabled: false,
    only: typecheckCli.only,
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
    // Vitest 5 defaults this to `true`, which folds the root config into every
    // project. Nothing here wants that: `shared` above is the whole of what a
    // project is meant to inherit, spelled out so a reader can see it, and the
    // root block holds only `projects` itself and the coverage settings that
    // are read from the root anyway.
    extends: false,
    test: {
      ...shared,
      name: p.name,
      root,
      exclude: [...shared.exclude, ...bunOnly],
      typecheck: {
        ...shared.typecheck,
        enabled: typecheckCli.enabled && p.name === "ai",
      },
    },
  };
});

export default defineConfig({
  envDir: __dirname,
  test: {
    projects,
    coverage: {
      provider: "v8", // or 'istanbul'
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [...configDefaults.exclude, "packages/test/**"],
    },
  },
});

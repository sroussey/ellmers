import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
// Extension is required: Vite's native config loader cannot resolve an
// extensionless relative import here.
import { discoverTestFiles, listTestProjects } from "./scripts/lib/testDiscovery.ts";

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
 * node-llama-cpp/ipull writes a shared `*.gguf.ipull` under ./models. Parallel
 * vitest file workers downloading the same URI race on rename(.ipull → .gguf).
 * Split those integration files into a project with `fileParallelism: false`
 * so a full `vitest run` (no file list — e.g. `bun run test vitest`) still
 * serializes them. They must also be excluded from the parallel `test` project
 * or they would run twice.
 */
const NODELLAMA_INTEGRATION_GLOB = "**/ai-provider-nodellama/**/*.integration.test.ts";

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
const projects = listTestProjects(discovered).flatMap((p) => {
  const root = abs(p.dir);
  const bunOnly = discovered
    .filter((f) => f.runner === "bun" && f.path.startsWith(root + "/"))
    .map((f) => f.path.slice(root.length + 1));
  const base = { ...shared, root, exclude: [...shared.exclude, ...bunOnly] };
  if (p.name !== "test") {
    return [{ test: { ...base, name: p.name } }];
  }
  return [
    { test: { ...base, name: p.name, exclude: [...base.exclude, NODELLAMA_INTEGRATION_GLOB] } },
    {
      test: {
        ...base,
        name: "test-nodellama",
        include: [NODELLAMA_INTEGRATION_GLOB],
        fileParallelism: false,
      },
    },
  ];
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

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test runner script. Supports filtering by kind and section.
 *
 * Usage: bun scripts/test.ts [--all] [kinds...] [sections...] [--help]
 *
 * Kinds:    unit, integration, end2end (default: all)
 * Sections: discovered from the tree — see `listSections()`
 *
 * Sections are DISCOVERED, never enumerated by hand. Every directory holding
 * tests maps to a section; a directory that matches no known grouping becomes
 * its own section rather than being silently dropped from every filtered run.
 * `--check-sections` fails if any test file is unreachable by section+kind
 * selection, which is what the CI matrix relies on.
 */

import { relative } from "node:path";
import type { Kind } from "./lib/testDiscovery";
import {
  discoverTestFiles,
  findUnreachable,
  KNOWN_KINDS,
  listSections,
  matchesKind,
  ROOT,
} from "./lib/testDiscovery";

const KNOWN_RUNNERS = ["bun", "vitest"] as const;

/** RAG ONNX/HuggingFace integration tests load multiple ONNX pipelines per file;
 * default parallelism makes two files load pipelines concurrently and OOM-kills the
 * GitHub-hosted runner (`bun test --parallel=1` is required even though it doubles
 * wall-clock time — the job timeout-minutes covers the extra runtime). */
function isRagOnnxIntegrationFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("/rag/") && normalized.includes(".integration.");
}

function shouldLimitParallelismForHeavyIntegration(files: string[]): boolean {
  return (
    shouldRunLlamaCppIntegrationFilesSequentially(files) || files.some(isRagOnnxIntegrationFile)
  );
}

/** node-llama-cpp/ipull downloads use shared ./models paths; parallel test files corrupt the same .gguf.ipull partial. */
function isLlamaCppProviderIntegrationFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  return normalized.includes("/ai-provider-nodellama/") && base.includes(".integration.test.ts");
}

function shouldRunLlamaCppIntegrationFilesSequentially(files: string[]): boolean {
  const n = files.filter(isLlamaCppProviderIntegrationFile).length;
  return n > 1;
}

function showHelp(sections: readonly string[]): void {
  console.log(`Usage: bun scripts/test.ts [kinds...] [sections...] [runners...] [options]

Kinds:    ${KNOWN_KINDS.join(", ")} (default: all)
Sections: ${sections.join(", ")}
Runners:  ${KNOWN_RUNNERS.join(", ")} (default: vitest; pass 'bun' to use Bun instead)

Options:
  --all             Run the full suite with no kind/section filter (very slow)
  --changed [base]  Run only packages affected by changes vs base (default origin/main),
                    via Turbo. Delegates package selection to the dependency graph.
  --check-sections  Verify every test file is reachable by section+kind selection
  --dry-run         Print runner commands without executing them
  --help            Show this usage message

Examples:
  bun scripts/test.ts --all                 # Run all tests
  bun scripts/test.ts unit                  # Run only unit tests
  bun scripts/test.ts storage unit          # Run only unit tests in storage dirs
  bun scripts/test.ts bun storage unit      # Run storage unit tests under Bun
  bun scripts/test.ts --changed             # Only packages affected since origin/main
`);
}

/** Run fast unit files before integration/e2e so ONNX-heavy suites start with a cleaner heap and predictable progress order. */
function orderFilteredTestFiles(files: string[]): string[] {
  if (files.length === 0) return files;
  const isHeavy = (f: string) => f.includes(".integration.") || f.includes(".e2e.");
  const light = files.filter((f) => !isHeavy(f)).sort((a, b) => a.localeCompare(b));
  const heavy = files.filter(isHeavy).sort((a, b) => a.localeCompare(b));
  return [...light, ...heavy];
}

function buildBunTestArgs(files: string[]): string[] {
  const parallelFlag: string =
    files.length > 0 && shouldLimitParallelismForHeavyIntegration(files)
      ? "--parallel=1"
      : "--parallel";
  // Match vitest's testTimeout: Bun's default is 5s per test, which is easy to exceed in HF/Sqlite work
  const timeoutFlag = "--timeout=15000";
  const flags = [timeoutFlag, parallelFlag].filter((flag) => flag.length > 0);
  return files.length > 0 ? ["bun", "test", ...flags, ...files] : ["bun", "test", ...flags];
}

function buildVitestArgs(files: string[]): string[] {
  // When no file filter: run all. Otherwise pass relative paths as name filters.
  const relFiles = files.length > 0 ? files.map((f) => relative(ROOT, f)) : [];
  const args = ["npx", "vitest", "run"];
  if (files.length > 0 && shouldLimitParallelismForHeavyIntegration(files)) {
    // One file at a time avoids OOM-kills when multiple ONNX-heavy suites load
    // pipelines in parallel — applies to both local and CI runners (GitHub-hosted
    // ubuntu-latest has ~7 GB RAM, easily exhausted by 2x ONNX feature-extraction
    // pipelines). The job's timeout-minutes covers the longer serial wall-clock.
    args.push("--no-file-parallelism");
  }
  if (process.env.CI) {
    args.push("--coverage");
  }
  args.push(...relFiles);
  return args;
}

/**
 * `preselected` says this script has already applied the kind filter and is
 * handing vitest an explicit file list, so the config's default tier exclude
 * must be turned off — it would drop integration files the caller named
 * outright. The Turbo path passes no files and therefore keeps the gate on,
 * which is what makes `turbo run test` mean "unit tier".
 */
async function spawnRunner(
  args: string[],
  label: string,
  opts: { preselected: boolean } = { preselected: true }
): Promise<number> {
  const proc = Bun.spawn(args, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    env: opts.preselected ? { ...process.env, WORKGLOW_TEST_TIER: "all" } : process.env,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) console.error(`${label} failed with exit code ${exitCode}`);
  return exitCode;
}

// ── Discover ──────────────────────────────────────────────────────────────────

const allFiles = discoverTestFiles();
const KNOWN_SECTIONS = listSections(allFiles);

// ── Parse args ────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.includes("--help")) {
  showHelp(KNOWN_SECTIONS);
  process.exit(0);
}

/**
 * Guard: a test file that no section+kind selection reaches never runs in CI,
 * because every CI job passes a kind. Discovery makes this structurally
 * impossible; this check keeps it that way.
 */
if (rawArgs.includes("--check-sections")) {
  const bySection = new Map<string, number>();
  for (const f of allFiles) bySection.set(f.section, (bySection.get(f.section) ?? 0) + 1);
  console.log(`Discovered ${allFiles.length} test file(s) across ${bySection.size} section(s):`);
  for (const s of [...bySection.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(s[1]).padStart(4)}  ${s[0]}`);
  }
  const unreachable = findUnreachable(allFiles);
  if (unreachable.length > 0) {
    console.error(`\n${unreachable.length} test file(s) unreachable by any section+kind:`);
    for (const f of unreachable) console.error(`  ${relative(ROOT, f.path)}`);
    process.exit(1);
  }
  console.log("\nEvery test file is reachable by section+kind selection.");
  process.exit(0);
}

const runAll = rawArgs.includes("--all");
const dryRun = rawArgs.includes("--dry-run");

/**
 * `--changed [base]` — run only the packages a change can reach.
 *
 * Package selection is delegated to Turbo rather than reimplemented here: it
 * already knows the workspace dependency graph, so `...[base]` means "packages
 * changed since base, plus everything that depends on them" — the transitive
 * half is the part a hand-rolled diff would get wrong.
 *
 * Only workspaces with a `test` script participate. Tooling tests that live
 * outside any workspace (`scripts/`) are NOT covered by this mode; run them
 * with `bun scripts/test.ts scripts`.
 */
const changedIdx = rawArgs.indexOf("--changed");
if (changedIdx !== -1) {
  const next = rawArgs[changedIdx + 1];
  const base = next !== undefined && !next.startsWith("-") ? next : "origin/main";
  const args = ["npx", "turbo", "run", "test", `--filter=...[${base}]`];
  console.log(`\nRunning tests for packages affected since ${base}\n`);
  if (dryRun) {
    console.log(JSON.stringify(args));
    process.exit(0);
  }
  process.exit(await spawnRunner(args, "Turbo test", { preselected: false }));
}

// `--changed` exits above, so only the plain flags need stripping here.
const filteredArgs = rawArgs.filter((a) => a !== "--all" && a !== "--dry-run");

if (!runAll && filteredArgs.length === 0) {
  showHelp(KNOWN_SECTIONS);
  process.exit(0);
}

// Bun is OFF unless asked for. It is a supported runner that occasionally
// surfaces real runtime differences, but running it alongside vitest by default
// doubles every run to re-verify vitest's own semantics on a second runtime.
// Ask for it explicitly (`bun scripts/test.ts bun unit`) or let the scheduled
// parity workflow do it.
const wantsBun = filteredArgs.includes("bun");
const bunOnly = wantsBun;
const vitestOnly = !wantsBun;
const kinds: Kind[] = [];
const sections: string[] = [];
const unknown: string[] = [];

for (const arg of filteredArgs) {
  if ((KNOWN_KINDS as readonly string[]).includes(arg)) kinds.push(arg as Kind);
  else if (KNOWN_SECTIONS.includes(arg)) sections.push(arg);
  else if ((KNOWN_RUNNERS as readonly string[]).includes(arg)) continue;
  else unknown.push(arg);
}

if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}`);
  console.error(`Valid kinds:    ${KNOWN_KINDS.join(", ")}`);
  console.error(`Valid sections: ${KNOWN_SECTIONS.join(", ")}`);
  console.error(`Valid runners:  ${KNOWN_RUNNERS.join(", ")}`);
  process.exit(1);
}

// ── Collect test files (when section or kind filter is given) ──────────────────

const needsFileFilter = sections.length > 0 || kinds.length > 0;
const selected = needsFileFilter
  ? allFiles
      .filter((f) => (sections.length === 0 ? true : sections.includes(f.section)))
      .filter((f) => matchesKind(f.path, kinds))
  : [];
const files: string[] = orderFilteredTestFiles(selected.map((f) => f.path));
// A `bun:test` file uses Bun-only APIs and cannot run under vitest; skip it there
// rather than letting vitest fail on an unresolvable `bun:test` import.
const vitestFiles: string[] = orderFilteredTestFiles(
  selected.filter((f) => f.runner !== "bun").map((f) => f.path)
);

if (needsFileFilter && files.length === 0) {
  const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
  const sectionLabel = sections.length > 0 ? sections.join("+") : "all";
  console.log(`No test files found for kind=${kindLabel} section=${sectionLabel}`);
  process.exit(0);
}

const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
const sectionLabel = sections.length > 0 ? sections.join("+") : "all";
const fileCount = files.length > 0 ? `${files.length} file(s)` : "all files";
console.log(`\nRunning ${kindLabel} tests in sections [${sectionLabel}] — ${fileCount}\n`);

if (dryRun) {
  if (!vitestOnly) console.log(JSON.stringify(buildBunTestArgs(files)));
  if (!bunOnly) {
    // An empty file list makes `vitest run` mean "run everything", so a
    // selection that filtered down to nothing must print no vitest command
    // rather than one that silently widens to the whole suite.
    if (needsFileFilter && vitestFiles.length === 0) {
      console.log("# vitest: skipped — no vitest-compatible files in selection");
    } else {
      console.log(JSON.stringify(buildVitestArgs(vitestFiles)));
    }
  }
  process.exit(0);
}

// ── Execute ───────────────────────────────────────────────────────────────────

if (!vitestOnly) {
  const code = await spawnRunner(buildBunTestArgs(files), "Bun test");
  if (code !== 0) process.exit(code);
}

if (!bunOnly) {
  if (needsFileFilter && vitestFiles.length === 0) {
    console.log("No vitest-compatible files in selection (all are bun-only).");
    process.exit(0);
  }
  process.exit(await spawnRunner(buildVitestArgs(vitestFiles), "Vitest test"));
}

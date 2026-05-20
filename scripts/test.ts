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
 * Sections: graph, task, storage, queue, util, ai, provider, mcp, rag (default: all)
 */

import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TEST_BASE = join(ROOT, "packages/test/src/test");

const KNOWN_KINDS = ["unit", "integration", "end2end"] as const;
type Kind = (typeof KNOWN_KINDS)[number];

const KNOWN_RUNNERS = ["bun", "vitest"] as const;
type Runner = (typeof KNOWN_RUNNERS)[number];

const KNOWN_SECTIONS = [
  "graph",
  // "browser",
  "task",
  "storage",
  "queue",
  "util",
  "ai",
  "provider",
  "provider-hft",
  "provider-nodellama",
  "provider-api",
  "aws",
  "cloudflare",
  "mcp",
  "rag",
  "resource",
] as const;
type Section = (typeof KNOWN_SECTIONS)[number];

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

const SECTION_DIRS: Record<Section, string[]> = {
  graph: [
    join(TEST_BASE, "task-graph"),
    join(TEST_BASE, "task-graph-cache"),
    join(TEST_BASE, "task-graph-job-queue"),
    join(TEST_BASE, "task-graph-output-cache"),
    join(TEST_BASE, "task-graph-storage"),
  ],
  task: [join(TEST_BASE, "task")],
  storage: [
    join(TEST_BASE, "storage-kv"),
    join(TEST_BASE, "storage-tabular"),
    join(TEST_BASE, "storage-util"),
    join(TEST_BASE, "storage-migrations"),
    join(TEST_BASE, "tabular-migrations"),
    join(TEST_BASE, "vector"),
  ],
  queue: [join(TEST_BASE, "job-queue")],
  util: [join(TEST_BASE, "util"), join(TEST_BASE, "human")],
  ai: [join(TEST_BASE, "ai"), join(TEST_BASE, "ai-model")],
  provider: [join(TEST_BASE, "ai-provider")],
  "provider-hft": [join(TEST_BASE, "ai-provider-hft")],
  "provider-nodellama": [join(TEST_BASE, "ai-provider-nodellama")],
  "provider-api": [join(TEST_BASE, "ai-provider-api")],
  aws: [join(TEST_BASE, "aws")],
  cloudflare: [join(TEST_BASE, "cloudflare")],
  mcp: [join(TEST_BASE, "mcp")],
  rag: [join(TEST_BASE, "rag")],
  resource: [join(TEST_BASE, "resource")],
  // browser: [join(TEST_BASE, "browser")],
};

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

function showHelp(): void {
  console.log(`Usage: bun scripts/test.ts [kinds...] [sections...] [runners...] [options]

Kinds:    ${KNOWN_KINDS.join(", ")} (default: all)
Sections: ${KNOWN_SECTIONS.join(", ")} (default: all)
Runners:  ${KNOWN_RUNNERS.join(", ")} (default: both)

Options:
  --all          Run full suite (bun + vitest, no filters, very slow)
  --dry-run      Print runner commands without executing them
  --help         Show this usage message

Examples:
  bun scripts/test.ts --all                 # Run all tests
  bun scripts/test.ts unit                  # Run only unit tests
  bun scripts/test.ts integration           # Run only integration tests
  bun scripts/test.ts storage               # Run only storage tests
  bun scripts/test.ts storage unit          # Run only unit tests in storage dirs
  bun scripts/test.ts graph task unit       # Run unit tests in graph + task dirs
  bun scripts/test.ts bun --all             # Run only tests using bun
  bun scripts/test.ts vitest --all          # Run only tests using vitest
  bun scripts/test.ts bun graph unit        # Run tests using bun in graph dirs
`);
}

function matchesKind(filePath: string, kinds: readonly Kind[]): boolean {
  if (kinds.length === 0) return true;
  const base = filePath.split("/").pop() ?? filePath;
  for (const kind of kinds) {
    if (kind === "unit" && !base.includes(".integration.") && !base.includes(".e2e.")) return true;
    if (kind === "integration" && base.includes(".integration.test.ts")) return true;
    if (kind === "end2end" && base.includes(".e2e.test.ts")) return true;
  }
  return false;
}

function collectFiles(
  dirs: string[],
  kinds: readonly Kind[],
  sections: readonly Section[]
): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.test.ts");
  for (const dir of dirs) {
    for (const file of glob.scanSync({ cwd: dir, absolute: true, onlyFiles: true })) {
      if (seen.has(file) || !matchesKind(file, kinds)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

/** Run fast unit files before integration/e2e so ONNX-heavy suites start with a cleaner heap and predictable progress order. */
function orderFilteredTestFiles(files: string[]): string[] {
  if (files.length === 0) return files;
  const isHeavy = (f: string) => f.includes(".integration.") || f.includes(".e2e.");
  const light = files.filter((f) => !isHeavy(f)).sort((a, b) => a.localeCompare(b));
  const heavy = files.filter(isHeavy).sort((a, b) => a.localeCompare(b));
  return [...light, ...heavy];
}

async function runBunTest(files: string[]): Promise<number> {
  const args = buildBunTestArgs(files);
  const proc = Bun.spawn(args, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`Bun test failed with exit code ${exitCode}`);
  }
  return exitCode;
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

async function runVitest(files: string[]): Promise<number> {
  const args = buildVitestArgs(files);
  const proc = Bun.spawn(args, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`Vitest test failed with exit code ${exitCode}`);
  }
  return exitCode;
}

// ── Parse args ────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.includes("--help")) {
  showHelp();
  process.exit(0);
}

const runAll = rawArgs.includes("--all");
const dryRun = rawArgs.includes("--dry-run");
const filteredArgs = rawArgs.filter((a) => a !== "--all" && a !== "--dry-run");

if (!runAll && filteredArgs.length === 0) {
  showHelp();
  process.exit(0);
}

const bunOnly = filteredArgs.includes("bun");
const vitestOnly = filteredArgs.includes("vitest");
const runners: Runner[] = [];
const kinds: Kind[] = [];
const sections: Section[] = [];
const unknown: string[] = [];

for (const arg of filteredArgs) {
  if ((KNOWN_KINDS as readonly string[]).includes(arg)) {
    kinds.push(arg as Kind);
  } else if ((KNOWN_SECTIONS as readonly string[]).includes(arg)) {
    sections.push(arg as Section);
  } else if (KNOWN_RUNNERS.includes(arg as Runner)) {
    runners.push(arg as Runner);
  } else {
    unknown.push(arg);
  }
}

if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}`);
  console.error(`Valid kinds:    ${KNOWN_KINDS.join(", ")}`);
  console.error(`Valid sections: ${KNOWN_SECTIONS.join(", ")}`);
  console.error(`Valid runners: ${KNOWN_RUNNERS.join(", ")}`);

  process.exit(1);
}

// ── Collect test files (when section or kind filter is given) ──────────────────

const needsFileFilter = sections.length > 0 || kinds.length > 0;
const dirs =
  sections.length > 0
    ? sections.flatMap((s) => SECTION_DIRS[s])
    : Object.values(SECTION_DIRS).flat();
const files: string[] = needsFileFilter
  ? orderFilteredTestFiles(collectFiles(dirs, kinds, sections))
  : [];

if (needsFileFilter && files.length === 0) {
  const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
  const sectionLabel = sections.join("+");
  console.log(`No test files found for kind=${kindLabel} section=${sectionLabel}`);
  process.exit(0);
}

const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
const sectionLabel = sections.length > 0 ? sections.join("+") : "all";
const fileCount = files.length > 0 ? `${files.length} file(s)` : "all files";
console.log(`\nRunning ${kindLabel} tests in sections [${sectionLabel}] — ${fileCount}\n`);

if (dryRun) {
  if (!vitestOnly) {
    console.log(JSON.stringify(buildBunTestArgs(files)));
  }
  if (!bunOnly) {
    console.log(JSON.stringify(buildVitestArgs(files)));
  }
  process.exit(0);
}

// ── Execute ───────────────────────────────────────────────────────────────────

if (!vitestOnly) {
  const code = await runBunTest(files);
  if (code !== 0) process.exit(code);
}

if (!bunOnly) {
  const code = await runVitest(files);
  process.exit(code);
}

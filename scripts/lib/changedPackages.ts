/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Package selection for `scripts/test.ts --changed`. Turbo owns the dependency
 * graph (`...[base]` = changed packages plus dependents); this module turns
 * that into project directories the file-list runner can filter on, so a kind
 * or section selector still applies.
 */

import { projectDirOf, ROOT, type TestFile } from "./testDiscovery";

/** Run every matching file — used when the diff cannot be scoped to packages. */
export type ChangedPackages = ReadonlySet<string> | "all";

/**
 * Root files that invalidate every package's tests. Turbo `--filter=[base]`
 * maps git paths onto packages and will select nothing for these, which would
 * make `--changed` skip the suite that most needs to run.
 */
const REPO_WIDE_TEST_PATHS: ReadonlySet<string> = new Set([
  "bun.lock",
  "bun.lockb",
  "package.json",
  "turbo.json",
  "vitest.config.ts",
  "vitest.setup.ts",
  "tsconfig.json",
]);

export function isRepoWideTestChange(paths: readonly string[]): boolean {
  return paths.some((p) => REPO_WIDE_TEST_PATHS.has(p));
}

export function filesInChangedPackages(
  files: readonly TestFile[],
  dirs: ReadonlySet<string>
): TestFile[] {
  return files.filter((f) => {
    const dir = projectDirOf(f.path);
    return dir !== undefined && dirs.has(dir);
  });
}

async function gitDiffNames(base: string): Promise<string[] | undefined> {
  const proc = Bun.spawn(["git", "diff", "--name-only", base], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return undefined;
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function turboChangedTestDirs(base: string): Promise<Set<string> | undefined> {
  const proc = Bun.spawn(
    ["npx", "turbo", "run", "test", `--filter=...[${base}]`, "--dry-run=json"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return undefined;
  let parsed: { tasks?: readonly { task?: string; directory?: string }[] };
  try {
    parsed = JSON.parse(stdout) as { tasks?: readonly { task?: string; directory?: string }[] };
  } catch {
    return undefined;
  }
  const dirs = new Set<string>();
  for (const task of parsed.tasks ?? []) {
    if (task.task === "test" && typeof task.directory === "string" && task.directory.length > 0) {
      dirs.add(task.directory);
    }
  }
  return dirs;
}

/**
 * Directories whose tests `--changed` should run, or `"all"` when the diff
 * cannot be attributed to a subset of packages (missing git object, or a
 * root-level config/lockfile change).
 *
 * `scripts/` is not a workspace, so Turbo never names it; a change there is
 * folded in from the git diff.
 */
export async function resolveChangedPackageDirs(base: string): Promise<ChangedPackages> {
  const paths = await gitDiffNames(base);
  if (paths === undefined) {
    console.warn(`--changed: could not diff against ${base}; running unfiltered`);
    return "all";
  }
  if (isRepoWideTestChange(paths)) return "all";

  const dirs = await turboChangedTestDirs(base);
  if (dirs === undefined) {
    console.warn(`--changed: turbo could not resolve packages vs ${base}; running unfiltered`);
    return "all";
  }
  if (paths.some((p) => p === "scripts" || p.startsWith("scripts/"))) {
    dirs.add("scripts");
  }
  return dirs;
}

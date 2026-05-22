/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replace each `root` prefix in `stack` with the literal placeholder
 * `<root>` so absolute filesystem paths (build-server home dirs, container
 * layouts, customer-specific deployment roots) don't leak through error
 * surfaces.
 *
 * Pure helper — returns the input unchanged when `stack` is undefined or
 * the `roots` list is empty. Multiple roots are applied in order;
 * empty-string roots are skipped (avoids replacing every empty position
 * with `<root>`).
 */
export function scrubStack(
  stack: string | undefined,
  roots: readonly string[]
): string | undefined {
  if (!stack) return stack;
  let out = stack;
  for (const root of roots) {
    if (!root) continue;
    out = out.split(root).join("<root>");
  }
  return out;
}

/**
 * Filesystem roots for {@link scrubStack}. Node/Bun return `process.cwd()`; browser
 * workers often define `process` without `cwd`, so this returns `[]` there.
 */
export function stackScrubRoots(): readonly string[] {
  try {
    if (typeof process !== "undefined" && typeof process.cwd === "function") {
      const cwd = process.cwd();
      return cwd ? [cwd] : [];
    }
  } catch {
    // ignore — unavailable in some worker runtimes
  }
  return [];
}

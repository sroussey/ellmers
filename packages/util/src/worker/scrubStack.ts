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

/**
 * Rebuilds an `Error` from the structured-cloned payload of a worker `error`
 * message. Defense-in-depth: a third-party worker that didn't go through our
 * scrubbing postError may still ship absolute paths in `data.stack`, so the
 * stack is re-scrubbed with the manager process's roots before the rehydrated
 * Error is handed to the caller.
 */
export function rehydrateWorkerError(data: unknown): Error {
  if (typeof data !== "object" || data === null) {
    return new Error(String(data));
  }
  const payload = data as { message?: string; name?: string; stack?: string };
  const scrubbedStack =
    typeof payload.stack === "string" ? scrubStack(payload.stack, stackScrubRoots()) : undefined;
  return Object.assign(new Error(payload.message ?? String(data)), {
    name: payload.name ?? "Error",
    ...(scrubbedStack !== undefined ? { stack: scrubbedStack } : {}),
  });
}

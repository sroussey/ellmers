/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskEntitlementError, TaskInvalidInputError } from "@workglow/task-graph";
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface LocalFilePathOptions {
  /**
   * Directories the path must resolve inside. `undefined` means unrestricted —
   * the enforced control is the `filesystem:read` entitlement, and this is the
   * embedder's belt-and-braces on top of it.
   */
  readonly roots?: readonly string[] | undefined;
}

/** True for an http(s) URL, case-insensitively — `HTTP://x` is an http URL. */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function fileUrlToPath(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TaskInvalidInputError(`Invalid file URL: ${url}`);
  }
  try {
    // Percent-decodes, rejects a non-empty non-localhost host, and yields
    // `C:\x` rather than `/c:/x` on Windows.
    return fileURLToPath(parsed);
  } catch (err) {
    throw new TaskInvalidInputError(
      `Invalid file URL: ${url} (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Real, absolute path for a local-file input, contained within `roots`.
 *
 * Order matters: the containment check runs AFTER `realpathSync`, so a symlink
 * pointing out of a root is caught rather than followed. Callers must open the
 * returned path, not the one they passed in.
 *
 * Residual TOCTOU: a component of the path can be swapped between this
 * resolution and the open that follows it. Closing that needs an
 * openat-with-fd-relative walk, which Node does not expose.
 */
export function resolveLocalFilePath(url: string, options: LocalFilePathOptions = {}): string {
  const raw = /^file:/i.test(url) ? fileUrlToPath(url) : url;
  const resolved = resolve(raw);

  let real: string;
  try {
    real = realpathSync(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // A missing file still gets a real DIRECTORY path, so containment is
    // decided on resolved ground; the open below then fails with ENOENT as it
    // always did.
    real = join(realpathSync(dirname(resolved)), basename(resolved));
  }

  const { roots } = options;
  if (roots !== undefined) {
    const allowed = roots.some((root) => {
      // A root that cannot be resolved is a misconfiguration, and saying which
      // one beats an `ENOENT ... lstat` raised from inside the containment
      // check. It is deliberately NOT treated as "does not contain the path":
      // that reads as a containment verdict on evidence nobody has.
      let realRoot: string;
      try {
        realRoot = realpathSync(root);
      } catch (err) {
        throw new TaskInvalidInputError(
          `Configured root ${root} could not be resolved: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      return real === realRoot || real.startsWith(realRoot + sep);
    });
    if (!allowed) {
      throw new TaskEntitlementError(
        `Path ${real} is outside the configured roots: ${roots.join(", ")}`
      );
    }
  }

  // A fifo or a character device (/dev/zero) reads forever with no deadline.
  let stats;
  try {
    stats = statSync(real);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return real;
    throw err;
  }
  if (!stats.isFile()) {
    throw new TaskInvalidInputError(`Not a regular file: ${real}`);
  }

  return real;
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const LOCK_POLL_MS = 50;
/** Steal a lock whose pid file is missing only after this age — crash between mkdir and pid write. */
const MISSING_PID_STALE_MS = 5_000;

export function ggufDownloadLockDir(dirPath: string, modelUri: string): string {
  const safe = modelUri.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  return resolve(dirPath, `.${safe}.download.lock`);
}

interface RenameEnoent {
  readonly code: string;
  readonly syscall: string | undefined;
  readonly dest: string | undefined;
  readonly path: string | undefined;
  readonly cause: unknown;
}

function asRenameEnoent(err: unknown): RenameEnoent | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const e = err as {
    code?: unknown;
    syscall?: unknown;
    dest?: unknown;
    path?: unknown;
    cause?: unknown;
  };
  return {
    code: typeof e.code === "string" ? e.code : "",
    syscall: typeof e.syscall === "string" ? e.syscall : undefined,
    dest: typeof e.dest === "string" ? e.dest : undefined,
    path: typeof e.path === "string" ? e.path : undefined,
    cause: e.cause,
  };
}

/** Destination `.gguf` path from an ipull `rename(.ipull → .gguf)` ENOENT, if present. */
export function ipullRenameDest(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const e = asRenameEnoent(current);
    if (e === undefined) break;
    if (e.code === "ENOENT" && e.syscall === "rename") {
      if (e.dest !== undefined) return e.dest;
      if (e.path !== undefined && e.path.endsWith(".ipull")) {
        return e.path.slice(0, -".ipull".length);
      }
    }
    current = e.cause;
  }
  return undefined;
}

/**
 * True when ipull's final rename lost a race: another process already moved
 * `.ipull` to the destination, so the dest file is the successful download.
 */
export function isBenignIpullRenameRace(err: unknown): boolean {
  const dest = ipullRenameDest(err);
  return dest !== undefined && existsSync(dest);
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // EPERM: process exists but we cannot signal it.
    return code === "EPERM";
  }
}

async function isStaleLock(lockDir: string): Promise<boolean> {
  try {
    const pidRaw = await readFile(join(lockDir, "pid"), "utf8");
    const pid = Number(pidRaw.trim());
    if (Number.isInteger(pid) && pid > 0 && pidIsAlive(pid)) return false;
    return true;
  } catch {
    try {
      const s = await stat(lockDir);
      return Date.now() - s.mtimeMs > MISSING_PID_STALE_MS;
    } catch {
      return true;
    }
  }
}

/**
 * Cross-process exclusive lock (mkdir) around a GGUF download destination.
 * Vitest file workers and provider workers are separate processes, so an
 * in-process mutex cannot serialize them.
 */
export async function withGgufDownloadLock<T>(lockDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(resolve(lockDir, ".."), { recursive: true });
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "EEXIST") throw err;
      if (await isStaleLock(lockDir)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, LOCK_POLL_MS));
    }
  }
  await writeFile(join(lockDir, "pid"), String(process.pid));
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

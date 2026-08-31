/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fills the gaps in Bun's built-in `vitest` compatibility shim so the same test
 * files run under both runners.
 *
 * `bun test` resolves `import { vi } from "vitest"` to its own shim rather than
 * to the real package. That shim covers mocks, spies and fake timers, but not
 * `setSystemTime`, the global/env stubbing pair, or the async timer variants —
 * a test using any of those throws `vi.X is not a function` under Bun while
 * passing under Vitest. The shim exposes one shared `vi` object, so a preload
 * can install the missing members once for every test file.
 *
 * Only referenced from `bunfig.toml`'s `[test].preload`; Vitest keeps its real
 * implementations. Each addition is guarded so a future Bun release that ships
 * its own version wins.
 */

import { setSystemTime } from "bun:test";
import { vi } from "vitest";

/** The shim's members are untyped from here; `vi`'s published type already declares them all. */
const target = vi as unknown as Record<string, unknown>;

function define(name: string, value: unknown): void {
  if (typeof target[name] !== "function") target[name] = value;
}

// ── System time ───────────────────────────────────────────────────────────────
// Bun's fake timers already advance `Date.now()` and `useRealTimers()` restores
// the real clock, so the whole gap is the setter itself.
define("setSystemTime", (time?: string | number | Date): typeof vi => {
  setSystemTime(time === undefined ? undefined : new Date(time));
  return vi;
});

// ── Global stubs ──────────────────────────────────────────────────────────────
/** First-seen value per stubbed global, so nested stubs restore the pre-test value. */
const globalStubs = new Map<PropertyKey, { readonly existed: boolean; readonly value: unknown }>();

define("stubGlobal", (name: PropertyKey, value: unknown): typeof vi => {
  if (!globalStubs.has(name)) {
    globalStubs.set(name, {
      existed: name in globalThis,
      value: (globalThis as Record<PropertyKey, unknown>)[name],
    });
  }
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  return vi;
});

define("unstubAllGlobals", (): typeof vi => {
  for (const [name, previous] of globalStubs) {
    if (previous.existed) {
      Object.defineProperty(globalThis, name, {
        value: previous.value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      delete (globalThis as Record<PropertyKey, unknown>)[name];
    }
  }
  globalStubs.clear();
  return vi;
});

// ── Environment stubs ─────────────────────────────────────────────────────────
const envStubs = new Map<string, string | undefined>();

define("stubEnv", (name: string, value: string | undefined): typeof vi => {
  if (!envStubs.has(name)) envStubs.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return vi;
});

define("unstubAllEnvs", (): typeof vi => {
  for (const [name, previous] of envStubs) {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  envStubs.clear();
  return vi;
});

// ── Async timer variants ──────────────────────────────────────────────────────
/**
 * Vitest interleaves the host's queues with each timer callback; Bun's timers
 * are synchronous. Draining after the advance covers the cases these suites
 * need — a timer whose callback awaits before resolving.
 *
 * The drain must not touch the clock: Bun's `advanceTimersByTime(0)` still
 * advances a full millisecond, so using it as a "flush" makes a timer due at
 * `t` fire while the test believes it is standing at `t - 1`.
 */
async function drainPendingWork(): Promise<void> {
  for (let i = 0; i < 32; i += 1) await Promise.resolve();
}

const advanceTimersByTime = (ms: number): void => {
  // Same reason: only a positive advance is a real advance under Bun.
  if (ms > 0)
    (vi as unknown as { advanceTimersByTime: (ms: number) => unknown }).advanceTimersByTime(ms);
};

define("advanceTimersByTimeAsync", async (ms: number): Promise<typeof vi> => {
  advanceTimersByTime(ms);
  await drainPendingWork();
  return vi;
});

define("advanceTimersToNextTimerAsync", async (): Promise<typeof vi> => {
  (vi as unknown as { advanceTimersToNextTimer: () => unknown }).advanceTimersToNextTimer();
  await drainPendingWork();
  return vi;
});

define("runAllTimersAsync", async (): Promise<typeof vi> => {
  (vi as unknown as { runAllTimers: () => unknown }).runAllTimers();
  await drainPendingWork();
  return vi;
});

define("runOnlyPendingTimersAsync", async (): Promise<typeof vi> => {
  (vi as unknown as { runOnlyPendingTimers: () => unknown }).runOnlyPendingTimers();
  await drainPendingWork();
  return vi;
});

// ── Type-level helpers ────────────────────────────────────────────────────────
// `vi.mocked` and `vi.hoisted` are identity functions at runtime in Vitest too.
define("mocked", <T>(item: T): T => item);
define("hoisted", <T>(factory: () => T): T => factory());

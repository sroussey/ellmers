/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression test: browser session churn under sequential standalone task runs.
 *
 * Three scenarios are pinned:
 *   BASELINE       – default RunCompletion strategy disposes the session after each
 *                    standalone task.run(), so a second BrowserNavigateTask with the
 *                    same sessionId throws.
 *   never scope    – a caller-provided ResourceScope(never) keeps the session alive
 *                    across multiple sequential task.run() calls.
 *   inactivity     – session survives while tasks are running, then auto-disposes
 *                    after the idle period (verified with fake timers).
 */

import {
  BrowserNavigateTask,
  BrowserSessionRegistry,
  BrowserSessionTask,
  registerBrowserDeps,
} from "@workglow/browser-control/task";
import { DisposeStrategy, ResourceScope } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MockBrowserContext } from "../browser/MockBrowserContext";
import { advanceFakeTimers } from "../helpers/advanceFakeTimers";

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

function setupDeps(): MockBrowserContext {
  const ctx = new MockBrowserContext();
  registerBrowserDeps({
    createContext: () => ctx,
    availableBackends: ["local"],
    defaultBackend: "local",
    profileStorage: {
      save: vi.fn(),
      load: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
    },
  });
  return ctx;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SequentialTasks – browser session churn regression", () => {
  beforeEach(async () => {
    await BrowserSessionRegistry.disconnectAll();
  });

  afterEach(async () => {
    await BrowserSessionRegistry.disconnectAll();
  });

  // -------------------------------------------------------------------------
  // BASELINE: default strategy disposes after each standalone run()
  // -------------------------------------------------------------------------

  describe("BASELINE – default strategy (RunCompletion)", () => {
    test("session is disposed after BrowserSessionTask.run() completes", async () => {
      setupDeps();

      const sessionTask = new BrowserSessionTask({ headless: true });
      // No caller-provided scope → runner auto-creates one with RunCompletion strategy.
      const { sessionId } = await sessionTask.run({});

      // The session must NOT be in the registry after run() finishes because the
      // auto-created scope's RunCompletion strategy called disposeAll() in the
      // finally block, which triggered ctx.disconnect() + registry.unregister().
      expect(BrowserSessionRegistry.has(sessionId)).toBe(false);
    });

    test("subsequent BrowserNavigateTask with the same sessionId throws", async () => {
      setupDeps();

      const sessionTask = new BrowserSessionTask({ headless: true });
      const { sessionId } = await sessionTask.run({});

      // Session is gone — navigate must throw.
      const navTask = new BrowserNavigateTask();
      await expect(navTask.run({ sessionId, url: "https://example.com" })).rejects.toThrow(
        /no session found/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // never scope: session survives across sequential runs
  // -------------------------------------------------------------------------

  describe("never scope – session shared across sequential task runs", () => {
    test("session is still registered after first run() and usable in second", async () => {
      const ctx = setupDeps();
      const scope = new ResourceScope({ strategy: DisposeStrategy.never() });

      const sessionTask = new BrowserSessionTask({ headless: true });
      const { sessionId } = await sessionTask.run({}, { resourceScope: scope });

      // Session must still be alive because the never strategy never disposes.
      expect(BrowserSessionRegistry.has(sessionId)).toBe(true);
      expect(ctx.connected).toBe(true);

      // A second task using the same sessionId must succeed.
      const navTask = new BrowserNavigateTask();
      const navResult = await navTask.run(
        { sessionId, url: "https://example.com" },
        { resourceScope: scope }
      );
      expect(navResult.sessionId).toBe(sessionId);

      // Session still alive after both tasks.
      expect(BrowserSessionRegistry.has(sessionId)).toBe(true);

      // Caller is responsible for teardown.
      await scope[Symbol.asyncDispose]();
      expect(BrowserSessionRegistry.has(sessionId)).toBe(false);
      expect(ctx.connected).toBe(false);
    });

    test("multiple sequential navigation tasks all succeed with the same session", async () => {
      setupDeps();
      const scope = new ResourceScope({ strategy: DisposeStrategy.never() });

      const sessionTask = new BrowserSessionTask({ headless: true });
      const { sessionId } = await sessionTask.run({}, { resourceScope: scope });

      const navTask = new BrowserNavigateTask();
      for (const url of [
        "https://example.com/page1",
        "https://example.com/page2",
        "https://example.com/page3",
      ]) {
        const result = await navTask.run({ sessionId, url }, { resourceScope: scope });
        expect(result.sessionId).toBe(sessionId);
      }

      // Session still alive after three navigations.
      expect(BrowserSessionRegistry.has(sessionId)).toBe(true);

      await scope[Symbol.asyncDispose]();
    });
  });

  // -------------------------------------------------------------------------
  // inactivity scope: session survives during activity, disposes after idle
  // -------------------------------------------------------------------------

  describe("inactivity scope – disposes after idle period", () => {
    test("session survives during task runs and auto-disposes after idle timeout", async () => {
      vi.useFakeTimers();
      try {
        const ctx = setupDeps();
        const IDLE_MS = 1000;
        const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(IDLE_MS) });

        const sessionTask = new BrowserSessionTask({ headless: true });
        const { sessionId } = await sessionTask.run({}, { resourceScope: scope });

        // When the caller owns the scope, the runner does NOT call runComplete()
        // automatically — the caller must do it to arm the inactivity timer.
        await scope.runComplete();

        // Timer is now armed but hasn't fired yet — session must still be registered.
        expect(BrowserSessionRegistry.has(sessionId)).toBe(true);
        expect(ctx.connected).toBe(true);

        // A sequential navigate task resets the timer via touch() on each run.
        const navTask = new BrowserNavigateTask();
        const navResult = await navTask.run(
          { sessionId, url: "https://example.com" },
          { resourceScope: scope }
        );
        await scope.runComplete(); // re-arm the timer after the navigate run
        expect(navResult.sessionId).toBe(sessionId);
        expect(BrowserSessionRegistry.has(sessionId)).toBe(true);

        // Advance time past the idle window — the timer callback should fire
        // and dispose the session.
        await advanceFakeTimers(IDLE_MS + 100);

        expect(BrowserSessionRegistry.has(sessionId)).toBe(false);
        expect(ctx.connected).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    test("touch during activity resets the idle timer", async () => {
      vi.useFakeTimers();
      try {
        const ctx = setupDeps();
        const IDLE_MS = 1000;
        const scope = new ResourceScope({ strategy: DisposeStrategy.inactivity(IDLE_MS) });

        const sessionTask = new BrowserSessionTask({ headless: true });
        const { sessionId } = await sessionTask.run({}, { resourceScope: scope });

        // Arm the inactivity timer for the first time (caller owns scope).
        await scope.runComplete();

        // Advance halfway through the idle window.
        await advanceFakeTimers(IDLE_MS / 2, { flush: false });
        expect(BrowserSessionRegistry.has(sessionId)).toBe(true);

        // Run another task — its execute() calls touch(), cancelling the pending
        // timer. The caller then re-arms via runComplete().
        const navTask = new BrowserNavigateTask();
        await navTask.run({ sessionId, url: "https://example.com" }, { resourceScope: scope });
        await scope.runComplete(); // re-arm with a fresh idleMs window

        // Another half-window passes — still within the new idle window, so
        // the session must survive.
        await advanceFakeTimers(IDLE_MS / 2, { flush: false });
        expect(BrowserSessionRegistry.has(sessionId)).toBe(true);
        expect(ctx.connected).toBe(true);

        // Now let the full idle window expire from the last touch.
        await advanceFakeTimers(IDLE_MS + 100);
        expect(BrowserSessionRegistry.has(sessionId)).toBe(false);
        expect(ctx.connected).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

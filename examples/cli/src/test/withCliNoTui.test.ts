/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Workflow } from "@workglow/task-graph";
import { afterEach, describe, expect, it } from "vitest";
import { tuiDisabledByEnv, withCli } from "../run-interactive";

/**
 * `WORKGLOW_NO_TUI` is the operator's way out of the terminal UI on a run whose
 * length is set by the data rather than by a human watching it.
 *
 * What it actually avoids is React's development-build profiler
 * instrumentation: a `performance.measure()` per component per commit, retained
 * for the process lifetime in Node's unbounded user-timing buffer. A run that
 * draws no UI performs no commits, so it cannot accumulate them — which is why
 * the switch has to work on a TTY, the only case where the question arises.
 * `NODE_ENV=production` is the better fix; this is the fallback.
 */
describe("WORKGLOW_NO_TUI", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalEnv = process.env.WORKGLOW_NO_TUI;

  afterEach(() => {
    (process.stdout as { isTTY?: boolean }).isTTY = originalIsTTY;
    if (originalEnv === undefined) delete process.env.WORKGLOW_NO_TUI;
    else process.env.WORKGLOW_NO_TUI = originalEnv;
  });

  const runOnFakeTty = async (): Promise<unknown> => {
    (process.stdout as { isTTY?: boolean }).isTTY = true;
    const wf = new Workflow();
    wf.pipe(async () => ({ ok: true }));
    // A plain run resolves; the Ink path would need a real terminal to draw
    // into, so reaching it at all is what this test is detecting.
    return withCli(wf, { interactive: true }).run();
  };

  it("runs plainly on a TTY when set", async () => {
    process.env.WORKGLOW_NO_TUI = "1";
    await expect(runOnFakeTty()).resolves.toBeDefined();
  });

  it.each(["1", "true", "yes", "on"])("reads %o as set", (value) => {
    process.env.WORKGLOW_NO_TUI = value;
    expect(tuiDisabledByEnv()).toBe(true);
  });

  // An explicit off value must not disable the UI: an operator exporting
  // `WORKGLOW_NO_TUI=0` in a shell profile is asking for the UI, not opting out
  // of it, and a bare presence check would read every one of these as "set".
  it.each(["0", "false", "", "  "])("reads %o as not set", (value) => {
    process.env.WORKGLOW_NO_TUI = value;
    expect(tuiDisabledByEnv()).toBe(false);
  });

  it("is not set when the variable is absent", () => {
    delete process.env.WORKGLOW_NO_TUI;
    expect(tuiDisabledByEnv()).toBe(false);
  });
});

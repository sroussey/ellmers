/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DisposeStrategy, type IDisposeStrategy } from "./DisposeStrategy";

/**
 * Suggested {@link IDisposeStrategy} per environment. Application code
 * typically picks one and either passes it to {@link ResourceScope}'s
 * constructor or sets it via `disposeStrategy` on a run config.
 *
 *  - `browser`: long-running web/extension hosts — 5 minute inactivity
 *  - `cli`: one-shot CLI — match the historical default (dispose on
 *    completion)
 *  - `server`: long-running server — 30 minute inactivity
 *  - `test`: keep resources alive across sequential standalone task runs
 *    that the test harness explicitly tears down
 */
export const DisposePresets = {
  browser: (): IDisposeStrategy => DisposeStrategy.inactivity(5 * 60_000),
  cli: (): IDisposeStrategy => DisposeStrategy.runCompletion(),
  server: (): IDisposeStrategy => DisposeStrategy.inactivity(30 * 60_000),
  test: (): IDisposeStrategy => DisposeStrategy.never(),
} as const;

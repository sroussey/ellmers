/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DisposeStrategy, type IDisposeStrategy } from "@workglow/util";

/**
 * Suggested default dispose strategy for hosts whose primary purpose is
 * driving the browser-control package. 5-minute inactivity matches typical
 * interactive test/CLI cadence.
 */
export const browserDisposeStrategy = (): IDisposeStrategy =>
  DisposeStrategy.inactivity(5 * 60_000);

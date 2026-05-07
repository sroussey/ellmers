/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConformanceFixture,
  ConformanceHandle,
} from "../ai-provider/types";

export interface WorkerProxyBoundaryOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<ConformanceHandle>;
  readonly capabilities: WorkerProxyCapabilities;
  readonly models: WorkerProxyModels;
  readonly fixture?: Partial<ConformanceFixture>;
  /**
   * Names of boundary assertions that are currently broken in this adapter.
   * Each named assertion is wrapped in `it.fails` instead of `it`.
   *
   * Known names:
   *   "boundary.disposeTerminatesWorker"
   *   "boundary.errorPropagation"
   *   "boundary.backlogOrdering"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
}

export interface WorkerProxyCapabilities {
  /** When true, the entire boundary block is replaced with a single skipped
   * test logging "<name>: requires browser test runner". */
  readonly browserOnly: boolean;
  /** When false, the throw-surfaces assertion only checks for a non-empty
   * error message; the stack-frame check is skipped. Default true. */
  readonly errorPropagation: boolean;
}

export interface WorkerProxyModels {
  readonly textGeneration?: string;
  readonly toolCalling?: string;
}

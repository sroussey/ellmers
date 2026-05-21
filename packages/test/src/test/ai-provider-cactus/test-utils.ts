/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { _testOnly } from "@workglow/cactus/ai";

const { CACTUS_RUN_FNS } = _testOnly;

/**
 * Resolve the Cactus run-fn registered for an exact `serves` capability set.
 * The lookup is order-independent (compares sorted joined strings).
 */
export function runFnFor(
  serves: readonly string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): AiProviderRunFn<any, any, any> {
  const target = [...serves].sort().join(",");
  const match = CACTUS_RUN_FNS.find((r) => [...r.serves].sort().join(",") === target);
  if (!match) {
    throw new Error(`No Cactus run-fn registered for serves=[${target}]`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return match.runFn as AiProviderRunFn<any, any, any>;
}

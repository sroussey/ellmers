/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import { _testOnly } from "@workglow/chrome-ai/ai";

const { WEB_BROWSER_RUN_FNS } = _testOnly;

export function runFnFor(serves: readonly string[]): AiProviderRunFn<any, any, any> {
  const target = [...serves].sort().join(",");
  const match = WEB_BROWSER_RUN_FNS.find((r) => [...r.serves].sort().join(",") === target);
  if (!match) {
    throw new Error(`No WebBrowser run-fn registered for serves=[${target}]`);
  }

  return match.runFn as AiProviderRunFn<any, any, any>;
}

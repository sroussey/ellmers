/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BunWebViewBackend } from "@workglow/browser-control/task";
import { describe } from "vitest";
import { isChromeAvailable } from "./chromeAvailability";
import { runGenericBrowserTaskTests } from "./genericBrowserTaskTests";

const bunWebViewAvailable =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Boolean((globalThis as any).Bun?.WebView) && isChromeAvailable();

describe.skipIf(!bunWebViewAvailable)("Browser Tasks (BunWebViewBackend)", () => {
  runGenericBrowserTaskTests(() => new BunWebViewBackend(), { hookTimeout: 30_000 });
});

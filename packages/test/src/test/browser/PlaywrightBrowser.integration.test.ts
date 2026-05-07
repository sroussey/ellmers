/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlaywrightBackend } from "@workglow/playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe } from "vitest";
import { runGenericBrowserTaskTests } from "./genericBrowserTaskTests";

// Playwright requires a browser binary — skip when unavailable.
let playwrightAvailable = false;
try {
  await import("playwright");
  playwrightAvailable = true;
} catch {
  // playwright not installed
}

describe.skipIf(!playwrightAvailable)("Browser Tasks (PlaywrightBackend)", () => {
  let sharedBrowser: Browser | null = null;

  beforeAll(async () => {
    const pw = await import("playwright");
    sharedBrowser = await pw.chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage"],
    });
  }, 60_000);

  afterAll(async () => {
    await sharedBrowser?.close();
    sharedBrowser = null;
  }, 60_000);

  // One shared Chromium process for the whole suite avoids flaky per-test launch/teardown.
  runGenericBrowserTaskTests(
    () => {
      if (!sharedBrowser) {
        throw new Error("PlaywrightBrowser.integration: shared browser not initialized");
      }
      return new PlaywrightBackend(sharedBrowser);
    },
    { hookTimeout: 20_000 }
  );
});

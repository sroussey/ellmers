/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runIBrowserContextConformance } from "../../contract/browser-context/runIBrowserContextConformance";

let playwrightAvailable = false;
try {
  await import("playwright");
  playwrightAvailable = true;
} catch {
  // playwright not installed
}

runIBrowserContextConformance({
  name: "Playwright",
  skip: !playwrightAvailable,
  timeout: 60_000,
  factory: async () => {
    const { PlaywrightBackend } = await import("@workglow/browser-control/task");
    return {
      create: async () => {
        const ctx = new PlaywrightBackend();
        await ctx.connect({ headless: true });
        return ctx;
      },
      dispose: async (ctx) => {
        await ctx.disconnect();
      },
    };
  },
  capabilities: {
    multipleTabs: true,
    networkRequests: false, // currently a no-op stub returning []; flips after Phase 4
    consoleMessages: false, // currently a no-op stub returning []; flips after Phase 4
    ariaSnapshot: true,
  },
  expectedFailures: [
    // PlaywrightBackend.ts:686-736 — array-index tabId race.
    "tabs.concurrentCloseStable",
    // PlaywrightBackend.ts:419-426 — lastIndexOf(":") parser.
    "aria.colonInName",
    // PlaywrightBackend.ts:768-774 — networkRequests/consoleMessages declared
    // as concrete arrow functions returning []. The negative-direction
    // capability honesty block requires `typeof ctx.networkRequests ===
    // "undefined"` when capabilities.networkRequests is false.
    "capability.networkRequests.undefinedWhenFalse",
    "capability.consoleMessages.undefinedWhenFalse",
  ],
});

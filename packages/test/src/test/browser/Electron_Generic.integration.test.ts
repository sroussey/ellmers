/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runIBrowserContextConformance } from "../../contract/browser-context/runIBrowserContextConformance";

const RUN_ELECTRON = !!process.env.RUN_ELECTRON_TESTS;

runIBrowserContextConformance({
  name: "Electron",
  skip: !RUN_ELECTRON,
  timeout: 60_000,
  factory: async () => {
    const { ElectronBackend } = await import("@workglow/browser-control/task");
    return {
      create: async () => {
        const ctx = new ElectronBackend();
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
    networkRequests: false,
    consoleMessages: false,
    ariaSnapshot: true,
  },
  // ElectronBackend.ts:440-446 declares empty-array stubs for both
  // networkRequests and consoleMessages (inherited behaviour from the
  // single-window model). The contract requires these to be strictly
  // undefined when the capability is false, so these assertions are
  // expected to fail until the stubs are removed or the capabilities
  // flags are flipped to true.
  expectedFailures: [
    "capability.networkRequests.undefinedWhenFalse",
    "capability.consoleMessages.undefinedWhenFalse",
  ],
});

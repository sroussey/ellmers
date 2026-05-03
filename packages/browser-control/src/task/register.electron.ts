/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Side-effect import: registers browser-control task dependencies for Electron runtimes.
 * Uses ElectronBackend with Playwright as a fallback for "local" backend.
 * Import @workglow/browser-control/task-electron to auto-wire this registration.
 */

import { ElectronBackend } from "./ElectronBackend";
import { PlaywrightBackend } from "./PlaywrightBackend";
import { registerBrowserDeps } from "./BrowserTaskDeps";

registerBrowserDeps({
  createContext: (options) => {
    if (options.backend === "local") {
      return new PlaywrightBackend();
    }
    return new ElectronBackend();
  },
  availableBackends: ["electron-native", "local"],
  defaultBackend: "electron-native",
  profileStorage: {
    async save(_projectId, _profileName, _state) {
      // ElectronBackend uses session.fromPartition for native persistence.
      // PlaywrightBackend storageState is not persisted in the Electron
      // entry point — use the server entry for that.
    },
    async load(_projectId, _profileName) {
      return null;
    },
    async delete(_projectId, _profileName) {
      // No-op: partition cleanup is handled by Electron session management.
      // Note: PlaywrightBackend profile persistence can be added later by
      // implementing filesystem-based storage here (see register.server.ts for the pattern).
    },
  },
});

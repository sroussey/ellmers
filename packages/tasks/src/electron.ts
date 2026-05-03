/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./codec.node";
import "./task/image/registerImageTextRenderer.node";
import "./util/SafeFetch.server";

export * from "./common";
export * from "./task/FileLoaderTask.server";
export * from "@workglow/browser-control/task";
export * from "./util/McpAuthProvider";
export * from "./util/McpAuthTypes";
export * from "./util/McpClientUtil";
export * from "./util/McpTaskDeps";

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { registerMcpTaskDepsServer } from "./server";
import { FileLoaderTask } from "./task/FileLoaderTask.server";
import {
  ElectronBackend,
  PlaywrightBackend,
  registerBrowserDeps,
} from "@workglow/browser-control/task";

registerMcpTaskDepsServer();

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
      // implementing filesystem-based storage here (see server.ts for the pattern).
    },
  },
});

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};

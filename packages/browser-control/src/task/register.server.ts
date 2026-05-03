/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Side-effect import: registers browser-control task dependencies for Node/Bun server runtimes.
 * Uses Playwright as the backend with filesystem-based profile storage.
 * Import @workglow/browser-control/task-server to auto-wire this registration.
 */

import path from "node:path";
import { PlaywrightBackend } from "./PlaywrightBackend";
import { registerBrowserDeps } from "./BrowserTaskDeps";

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function safeName(value: string, label: string): string {
  if (!SAFE_NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${label}: must contain only alphanumeric characters, hyphens, and underscores`
    );
  }
  return value;
}

registerBrowserDeps({
  createContext: (_options) => new PlaywrightBackend(),
  availableBackends: ["local", "cloud"],
  defaultBackend: "local",
  profileStorage: {
    async save(projectId, profileName, state) {
      const fs = await import("node:fs/promises");
      const dir = path.join(
        process.cwd(),
        ".workglow",
        "browser-profiles",
        safeName(projectId, "projectId")
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${safeName(profileName, "profileName")}.json`),
        state,
        "utf-8"
      );
    },
    async load(projectId, profileName) {
      const fs = await import("node:fs/promises");
      try {
        return await fs.readFile(
          path.join(
            process.cwd(),
            ".workglow",
            "browser-profiles",
            safeName(projectId, "projectId"),
            `${safeName(profileName, "profileName")}.json`
          ),
          "utf-8"
        );
      } catch {
        return null;
      }
    },
    async delete(projectId, profileName) {
      const fs = await import("node:fs/promises");
      try {
        await fs.unlink(
          path.join(
            process.cwd(),
            ".workglow",
            "browser-profiles",
            safeName(projectId, "projectId"),
            `${safeName(profileName, "profileName")}.json`
          )
        );
      } catch {
        /* ignore */
      }
    },
  },
});

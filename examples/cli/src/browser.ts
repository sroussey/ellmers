/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import type { CliConfig } from "./config";

const SAFE_NAME_RE = /^[\w-]+$/;

function safeName(value: string, label: string): string {
  if (!SAFE_NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${label}: must contain only alphanumeric characters, hyphens, and underscores`
    );
  }
  return value;
}

export async function registerCliBrowserDeps(config: CliConfig): Promise<void> {
  const backend = config.browser?.backend ?? "bun-webview";
  const chromePath = config.browser?.["chrome-path"];
  // const headless = config.browser?.headless;

  const { registerBrowserDeps } = await import("@workglow/browser-control/task");

  const profileBaseDir = path.join(path.dirname(config.directories.cache), "browser-profiles");

  if (backend === "bun-webview") {
    const { BunWebViewBackend } = await import("@workglow/bun-webview");
    registerBrowserDeps({
      createContext: (_options) => {
        return new BunWebViewBackend(chromePath);
      },
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage: buildProfileStorage(profileBaseDir),
    });
  } else if (backend === "playwright") {
    const { PlaywrightBackend } = await import("@workglow/playwright");
    registerBrowserDeps({
      createContext: (_options) => {
        const pw = new PlaywrightBackend();
        return pw;
      },
      availableBackends: ["local", "cloud"],
      defaultBackend: "local",
      profileStorage: buildProfileStorage(profileBaseDir),
    });
  } else {
    throw new Error(
      `Unknown browser backend "${backend}". Valid options: "bun-webview", "playwright".`
    );
  }
}

function buildProfileStorage(baseDir: string) {
  return {
    async save(projectId: string, profileName: string, state: string): Promise<void> {
      const fs = await import("node:fs/promises");
      const dir = path.join(baseDir, safeName(projectId, "projectId"));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${safeName(profileName, "profileName")}.json`),
        state,
        "utf-8"
      );
    },
    async load(projectId: string, profileName: string): Promise<string | null> {
      const fs = await import("node:fs/promises");
      try {
        return await fs.readFile(
          path.join(
            baseDir,
            safeName(projectId, "projectId"),
            `${safeName(profileName, "profileName")}.json`
          ),
          "utf-8"
        );
      } catch {
        return null;
      }
    },
    async delete(projectId: string, profileName: string): Promise<void> {
      const fs = await import("node:fs/promises");
      try {
        await fs.unlink(
          path.join(
            baseDir,
            safeName(projectId, "projectId"),
            `${safeName(profileName, "profileName")}.json`
          )
        );
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { PlaywrightBackend, registerBrowserDeps } from "@workglow/browser-control/task";
import { mcpClientFactory, mcpServerConfigSchema } from "./util/McpClientUtil";
import type { McpServerConfig } from "./util/McpTaskDeps";
import { registerMcpTaskDeps } from "./util/McpTaskDeps";

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function safeName(value: string, label: string): string {
  if (!SAFE_NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${label}: must contain only alphanumeric characters, hyphens, and underscores`
    );
  }
  return value;
}

export function registerMcpTaskDepsServer(): void {
  registerMcpTaskDeps({
    mcpClientFactory,
    mcpServerConfigSchema,
    createStdioTransport: (config: McpServerConfig) =>
      Promise.resolve(
        new StdioClientTransport({
          command: config.command!,
          args: config.args,
          env: config.env,
        })
      ),
  });
}

export function registerBrowserDepsServer(): void {
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
}

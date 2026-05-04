/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Side-effect import: registers MCP task dependencies for Node/Bun server runtimes.
 * Import this module (or @workglow/mcp/tasks from a node/bun entry) before using MCP tasks.
 */

import { registerMcpTaskDepsServer } from "./server";

registerMcpTaskDepsServer();

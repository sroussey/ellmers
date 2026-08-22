/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebSearchTasks } from "./common";

export * from "./common";

/**
 * The task class is registered so a browser host can render the node, show its
 * ports, and validate a graph containing it. No provider is registered: every
 * search API authenticates with a request header, which forces a CORS preflight
 * none of them answer, and executing one in a page would put the API key where
 * any visitor can read it. Running the task here throws from the registry,
 * naming what to import on the server.
 */
registerWebSearchTasks();

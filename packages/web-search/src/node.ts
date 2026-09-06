/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebSearchTasks } from "./common";

export * from "./common";

/**
 * The task class is registered so a host can build, render and validate a graph
 * containing the node. Providers are not: every vendor adapter value-imports
 * this package to reach `registerWebSearchProvider`, so anything registered
 * here is registered by the mere act of importing
 * `@workglow/anthropic/web-search` — putting Brave at the front of `"auto"`
 * routing in an app that asked for Anthropic, and standing a SearXNG instance
 * up from an environment variable nobody read.
 *
 * Which providers exist is the host's decision, and it states it by calling
 * {@link registerBuiltInWebSearchProviders} or {@link registerWebSearchProvider}.
 */
registerWebSearchTasks();

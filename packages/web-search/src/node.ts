/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerBuiltInWebSearchProviders, registerWebSearchTasks } from "./common";

export * from "./common";

registerWebSearchTasks();
registerBuiltInWebSearchProviders();

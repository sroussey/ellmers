/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Convenience subpath that bootstraps the global Workglow runtime with the
 * tslog-backed logger. Equivalent to:
 *
 * ```ts
 * import { bootstrapWorkglow, TsLogLogger } from "workglow";
 * bootstrapWorkglow({ logger: new TsLogLogger() });
 * ```
 *
 * Use it when you want the historical "import workglow and go" ergonomics
 * without a separate startup call:
 *
 * ```ts
 * import "workglow/auto-bootstrap";
 * ```
 *
 * For library code, multi-tenant servers, tests, or any use case that needs
 * a configurable or isolated registry, prefer `bootstrapWorkglow()` /
 * `createOrchestrationContext()` from `workglow/bootstrap`.
 */

import { bootstrapWorkglow } from "./bootstrap";
import { TsLogLogger } from "./logging";

bootstrapWorkglow({ logger: new TsLogLogger() });

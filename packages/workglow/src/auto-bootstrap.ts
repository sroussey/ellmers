/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Convenience subpath that bootstraps the global Workglow runtime with the
 * tslog-backed logger and installs the fluent `Workflow` trigger methods.
 * Equivalent to:
 *
 * ```ts
 * import { bootstrapWorkglow, installWorkflowTriggers, TsLogLogger } from "workglow";
 * bootstrapWorkglow({ logger: new TsLogLogger() });
 * installWorkflowTriggers();
 * ```
 *
 * Use it for "import workglow and go" ergonomics:
 *
 * ```ts
 * import "workglow/auto-bootstrap";
 * ```
 *
 * For library code, multi-tenant servers, tests, or any case needing a
 * configurable or isolated registry, prefer `bootstrapWorkglow()` /
 * `createOrchestrationContext()` from `workglow/bootstrap` — and call
 * `installWorkflowTriggers()` yourself if you want `workflow.trigger(...)`
 * rather than the free functions `bindWorkflowTrigger` / `listenWorkflow` /
 * `stopWorkflowListening`.
 *
 * This module is the ONLY side-effectful entry point of the package, which is
 * what `"sideEffects": ["./dist/auto-bootstrap.js"]` in the manifest says: the
 * barrel stays elidable, so an app importing `{ Workflow } from "workglow"`
 * does not drag duckdb, postgres, sqlite and mcp into its bundle.
 */

import { installWorkflowTriggers } from "@workglow/triggers";

import { bootstrapWorkglow } from "./bootstrap";
import { TsLogLogger } from "./logging";

bootstrapWorkglow({ logger: new TsLogLogger() });
installWorkflowTriggers();

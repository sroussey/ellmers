/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// This barrel is PURE: nothing here patches `Workflow.prototype`, so a bundler
// may elide any of it. `installWorkflowTriggers()` is what installs the fluent
// `.trigger()` / `.listen()` methods, and a consumer calls it (or uses the free
// functions instead). Do not re-add a bare `import "./workflow/WorkflowTriggers"`:
// it would make this module side-effectful, and every package re-exporting it —
// `workglow`'s barrel most of all — would be pinned into consumer bundles along
// with duckdb, postgres, sqlite and mcp, none of which declare `sideEffects`.

export * from "./cron/CronSchedule";
export * from "./trigger/BaseTrigger";
export * from "./trigger/CronTrigger";
export * from "./trigger/fixedInterval";
export * from "./trigger/IntervalTrigger";
export * from "./trigger/ITrigger";
export * from "./trigger/PollingTrigger";
export * from "./trigger/TriggerError";
export * from "./workflow/WorkflowTriggers";

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

// Load first: this module patches Workflow.prototype, so importing it before
// the value exports guarantees `.trigger()` / `.listen()` exist on any Workflow
// a consumer touches after importing this package. The package deliberately
// does NOT declare `"sideEffects": false` — a bundler that believed it would
// drop this patch and leave those methods undefined at runtime. Nor may a
// package that re-exports this one: webpack re-routes an
// `import { Workflow } from "workglow"` straight to `@workglow/task-graph` and
// never consults this package's flag, so the barrel has to claim side effects
// on its own behalf (i.e. by not declaring the field at all).
import "./workflow/WorkflowTriggers";

export * from "./cron/CronSchedule";
export * from "./trigger/BaseTrigger";
export * from "./trigger/CronTrigger";
export * from "./trigger/ITrigger";
export * from "./trigger/fixedInterval";
export * from "./trigger/IntervalTrigger";
export * from "./trigger/PollingTrigger";
export * from "./trigger/TriggerError";
export * from "./workflow/WorkflowTriggers";

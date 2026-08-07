/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

// Intentionally empty. The runtime-agnostic bindings that used to live here —
// InMemoryTaskOutputRepository, InMemoryTaskGraphRepository — now ship from
// `@workglow/task-graph/test`, which is where their base classes live. This
// file remains the browser/node split point for anything that cannot.
export {};

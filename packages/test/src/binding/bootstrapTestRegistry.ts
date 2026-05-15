/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bootstrap helper for the vitest harness.
 *
 * Workglow packages no longer self-register defaults at import time. The
 * vitest setup file uses this helper to populate the global registry with
 * the same defaults that production callers obtain via `bootstrapWorkglow()`.
 *
 * This module lives inside `@workglow/test` (rather than `vitest.setup.ts`)
 * so it can resolve workspace `@workglow/*` packages without root-level deps.
 */

import { registerAiProviderDefaults, registerModelDefaults } from "@workglow/ai";
import { registerKnowledgeBaseDefaults } from "@workglow/knowledge-base";
import { registerMcpServerDefaults } from "@workglow/mcp/util";
import { registerTabularStorageDefaults } from "@workglow/storage";
import { registerTaskDefaults, registerTransformDefaults } from "@workglow/task-graph";
import {
  registerCredentialDefaults,
  registerInputCompactorDefaults,
  registerInputResolverDefaults,
  registerLoggerDefaults,
  registerTelemetryDefaults,
} from "@workglow/util";
import { registerImageDefaults } from "@workglow/util/media";
import { registerWorkerManagerDefaults } from "@workglow/util/worker";

/**
 * Idempotently registers all built-in defaults on the global registry.
 * Mirrors `bootstrapWorkglow()` from the `workglow` meta-package, but
 * importable from a workspace package without taking a dependency on
 * the meta-package itself.
 */
export function bootstrapTestRegistry(): void {
  registerInputResolverDefaults();
  registerInputCompactorDefaults();
  registerLoggerDefaults();
  registerTelemetryDefaults();
  registerWorkerManagerDefaults();
  registerImageDefaults();
  registerCredentialDefaults();
  registerModelDefaults();
  registerAiProviderDefaults();
  registerKnowledgeBaseDefaults();
  registerMcpServerDefaults();
  registerTabularStorageDefaults();
  registerTaskDefaults();
  registerTransformDefaults();
}

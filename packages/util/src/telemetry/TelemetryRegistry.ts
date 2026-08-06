/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "../di/ServiceRegistry";
import { createServiceToken, globalServiceRegistry } from "../di/ServiceRegistry";
import { readRuntimeEnv } from "../utilities/runtimeEnv";
import { ConsoleTelemetryProvider } from "./ConsoleTelemetryProvider";
import type { ITelemetryProvider } from "./ITelemetryProvider";
import { NoopTelemetryProvider } from "./NoopTelemetryProvider";

/**
 * Service token for the global telemetry provider instance.
 */
export const TELEMETRY_PROVIDER = createServiceToken<ITelemetryProvider>("telemetry");

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function createDefaultTelemetryProvider(): ITelemetryProvider {
  if (readRuntimeEnv("TELEMETRY")?.toLowerCase() === "console") {
    return new ConsoleTelemetryProvider();
  }
  if (
    isTruthy(readRuntimeEnv("DEV")) &&
    readRuntimeEnv("NODE_ENV") !== "test" &&
    !isTruthy(readRuntimeEnv("VITEST")) &&
    !isTruthy(readRuntimeEnv("CI"))
  ) {
    return new ConsoleTelemetryProvider();
  }
  return new NoopTelemetryProvider();
}

/**
 * Registers the default telemetry provider factory on the given registry.
 * Called by `bootstrapWorkglow` / `createOrchestrationContext`.
 */
export function registerTelemetryDefaults(registry: ServiceRegistry = globalServiceRegistry): void {
  registry.registerIfAbsent(TELEMETRY_PROVIDER, createDefaultTelemetryProvider, true);
}

// Self-register on the global registry. Idempotent.
registerTelemetryDefaults();

/**
 * Returns the telemetry provider from the given registry (defaults to global).
 */
export function getTelemetryProvider(
  registry: ServiceRegistry = globalServiceRegistry
): ITelemetryProvider {
  if (!registry.has(TELEMETRY_PROVIDER)) {
    registerTelemetryDefaults(registry);
  }
  return registry.get(TELEMETRY_PROVIDER);
}

/**
 * Replaces the telemetry provider on the given registry (defaults to global).
 *
 * @example
 * ```ts
 * import { OTelTelemetryProvider } from "@workglow/util";
 * import { trace } from "@opentelemetry/api";
 *
 * setTelemetryProvider(new OTelTelemetryProvider(trace.getTracer("my-app")));
 * ```
 */
export function setTelemetryProvider(
  provider: ITelemetryProvider,
  registry: ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(TELEMETRY_PROVIDER, provider);
}

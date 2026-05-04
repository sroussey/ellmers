/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di/ServiceRegistry";
import { readRuntimeEnv } from "../utilities/runtimeEnv";
import type { LogLevel } from "./ConsoleLogger";
import { ConsoleLogger } from "./ConsoleLogger";
import type { ILogger } from "./ILogger";
import { NullLogger } from "./NullLogger";

/**
 * Service token for the global logger instance.
 */
export const LOGGER = createServiceToken<ILogger>("logger");

const VALID_LOG_LEVELS: ReadonlySet<string> = new Set<string>([
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function createDefaultLogger(): ILogger {
  const levelEnv = readRuntimeEnv("LOGGER_LEVEL")?.toLowerCase();
  if (levelEnv && VALID_LOG_LEVELS.has(levelEnv)) {
    return new ConsoleLogger({
      level: levelEnv as LogLevel,
      timings: isTruthy(readRuntimeEnv("LOGGER_TIMINGS")),
    });
  }
  if (isTruthy(readRuntimeEnv("DEV"))) {
    return new ConsoleLogger({
      level: "debug" as LogLevel,
      timings: true,
    });
  }
  return new NullLogger();
}

/**
 * Registers the default logger factory on the given registry if absent.
 * Called by `bootstrapWorkglow` / `createOrchestrationContext`.
 */
export function registerLoggerDefaults(
  registry: import("../di/ServiceRegistry").ServiceRegistry = globalServiceRegistry
): void {
  registry.registerIfAbsent(LOGGER, createDefaultLogger, true);
}

// Self-register on the global registry. Idempotent.
registerLoggerDefaults();

/**
 * Returns the logger from the given registry (defaults to global).
 * If no logger is registered yet, a NullLogger is returned via the default factory.
 */
export function getLogger(
  registry: import("../di/ServiceRegistry").ServiceRegistry = globalServiceRegistry
): ILogger {
  if (!registry.has(LOGGER)) {
    registerLoggerDefaults(registry);
  }
  return registry.get(LOGGER);
}

/**
 * Replaces the logger instance on the given registry (defaults to global).
 */
export function setLogger(
  logger: ILogger,
  registry: import("../di/ServiceRegistry").ServiceRegistry = globalServiceRegistry
): void {
  registry.registerInstance(LOGGER, logger);
}

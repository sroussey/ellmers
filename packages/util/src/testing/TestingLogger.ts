/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Package specifier, not `../logging/*`: `./test` is its own
// `bun build --packages=external` bundle, so a relative import would inline a
// second copy of ConsoleLogger and NullLogger here. The bare specifier stays
// external and shares the one copy the rest of the code uses.
import type { ILogger, LogLevel } from "@workglow/util";
import { ConsoleLogger, NullLogger } from "@workglow/util";

function getEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return import.meta.env?.[name];
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function isActionsDebug(): boolean {
  return isTruthy(getEnv("RUNNER_DEBUG")) || isTruthy(getEnv("ACTIONS_STEP_DEBUG"));
}

/** Same allowed values as `LOGGER_LEVEL` in the util package default logger. */
const VALID_LOG_LEVELS: ReadonlySet<string> = new Set<string>([
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

/**
 * Default logger used when tests call `setLogger(getTestingLogger())`.
 *
 * - **Console** when `RUNNER_DEBUG` or `ACTIONS_STEP_DEBUG` is set (GitHub Actions debug).
 * - **Console** when `LOGGER_LEVEL` is a valid level (matches app default logger behavior).
 * - **Console** when `WORKGLOW_TEST_LOG` is truthy or `console` — optional level via
 *   `WORKGLOW_TEST_LOG_LEVEL` or `LOGGER_LEVEL`.
 * - **Console** when `DEV` is set (matches app dev logging).
 * - Otherwise **NullLogger** (quiet CI/local runs).
 */
function createInitialTestingLogger(): ILogger {
  const timings = isTruthy(getEnv("LOGGER_TIMINGS"));
  if (isActionsDebug()) {
    return new ConsoleLogger({ level: "debug", timings });
  }

  const levelEnv = getEnv("LOGGER_LEVEL")?.toLowerCase();
  const testLogLevelEnv = getEnv("WORKGLOW_TEST_LOG_LEVEL")?.toLowerCase();
  const testLogRaw = getEnv("WORKGLOW_TEST_LOG");
  const wantsTestConsole = isTruthy(testLogRaw) || testLogRaw?.toLowerCase() === "console";

  function resolveLevel(fallback: LogLevel): LogLevel {
    if (testLogLevelEnv && VALID_LOG_LEVELS.has(testLogLevelEnv)) {
      return testLogLevelEnv as LogLevel;
    }
    if (levelEnv && VALID_LOG_LEVELS.has(levelEnv)) {
      return levelEnv as LogLevel;
    }
    return fallback;
  }

  if (wantsTestConsole) {
    return new ConsoleLogger({ level: resolveLevel("debug"), timings });
  }
  if (levelEnv && VALID_LOG_LEVELS.has(levelEnv)) {
    return new ConsoleLogger({ level: levelEnv as LogLevel, timings });
  }
  if (getEnv("DEV")) {
    return new ConsoleLogger({ level: "debug", timings: true });
  }
  return new NullLogger();
}

let testingLogger: ILogger = createInitialTestingLogger();

export function setTestingLogger(logger: ILogger): void {
  testingLogger = logger;
}

export function getTestingLogger(): ILogger {
  return testingLogger;
}

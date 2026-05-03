/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTelemetryProvider, SpanStatusCode } from "@workglow/util";

/**
 * Executes an async function within a telemetry span.
 */
export async function traced<T>(
  spanName: string,
  storageName: string,
  fn: () => Promise<T>
): Promise<T> {
  const telemetry = getTelemetryProvider();
  if (!telemetry.isEnabled) return fn();
  const span = telemetry.startSpan(spanName, {
    attributes: { "workglow.storage.name": storageName },
  });
  try {
    const result = await fn();
    span.setStatus(SpanStatusCode.OK);
    return result;
  } catch (err) {
    span.setStatus(SpanStatusCode.ERROR, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    span.end();
  }
}

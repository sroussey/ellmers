/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ISpan,
  ITelemetryProvider,
  SpanAttributes,
  SpanOptions,
  SpanStatusCode,
} from "./ITelemetryProvider";

/**
 * A no-op span that does nothing. Used when telemetry is disabled.
 */
const NOOP_SPAN: ISpan = {
  setAttributes(_attributes: SpanAttributes): void {},
  addEvent(_name: string, _attributes?: SpanAttributes): void {},
  setStatus(_code: SpanStatusCode, _message?: string): void {},
  end(): void {},
};

/**
 * Default no-op telemetry provider. All methods are zero-cost stubs.
 * This is the default provider when no telemetry backend is configured.
 */
export class NoopTelemetryProvider implements ITelemetryProvider {
  readonly isEnabled = false;

  startSpan(_name: string, _options?: SpanOptions): ISpan {
    return NOOP_SPAN;
  }
}

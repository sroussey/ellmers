/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter, EventParameters } from "@workglow/util";
import { getLogger } from "@workglow/util";

/**
 * Emit an event without letting a throwing listener crash the caller.
 *
 * The shared {@link EventEmitter.emit} rethrows listener errors
 * synchronously (or as an `AggregateError`). Storage write paths use
 * that signal to trigger rollback, so they must not be derailed by a
 * misbehaving subscriber. Listener errors are surfaced via
 * `getLogger().warn` and re-thrown on a microtask so
 * `unhandledrejection` / `process.on("unhandledRejection")` can still
 * observe them; the synchronous caller keeps running.
 */
export function safeEmit<
  Events extends Record<string, (...args: any) => any>,
  Event extends keyof Events,
>(emitter: EventEmitter<Events>, event: Event, ...args: EventParameters<Events, Event>): void {
  try {
    emitter.emit(event, ...args);
  } catch (e) {
    getLogger().warn("Listener threw during storage event emit", {
      event: String(event),
      error: e,
    });
    queueMicrotask(() => {
      throw e;
    });
  }
}

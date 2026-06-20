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
 * `getLogger().warn` so observability tooling still sees the bug; the
 * synchronous caller keeps running.
 *
 * The error is intentionally NOT re-thrown onto the unhandled-rejection
 * channel: Node's default mode (`--unhandled-rejections=throw`, the
 * default since Node 15) terminates the process on an unhandled
 * rejection, which would turn a misbehaving subscriber into a crash —
 * the exact failure this helper exists to prevent.
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
  }
}

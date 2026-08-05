/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import type { TaskError } from "../task/TaskError";
import type { TaskStatus } from "../task/TaskTypes";

/**
 * Event listeners for dataflow events
 */

export type DataflowEventListeners = {
  /** Fired when a source task starts execution */
  start: () => void;

  /** Fired when a source task begins streaming output */
  streaming: () => void;

  /** Fired when a source task completes successfully */
  complete: () => void;

  /** Fired when a source task is disabled */
  disabled: () => void;

  /** Fired when a source task is aborted */
  abort: () => void;

  /** Fired when a source task encounters an error */
  error: (error: TaskError) => void;

  /** Fired when a dataflow is reset to original state */
  reset: () => void;

  /** Fired when a dataflow status changes */
  status: (status: TaskStatus) => void;
};
/** Union type of all possible dataflow event names */

export type DataflowEvents = keyof DataflowEventListeners;
/** Type for dataflow event listener functions */

export type DataflowEventListener<Event extends DataflowEvents> = DataflowEventListeners[Event];
/** Type for dataflow event parameters */

export type DataflowEventParameters<Event extends DataflowEvents> = EventParameters<
  DataflowEventListeners,
  Event
>;
